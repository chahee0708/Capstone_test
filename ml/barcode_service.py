"""
barcode_service.py
- 역할: 루트의 B/ 폴더에 있는 바코드 모듈(barcode_module.py + mapping.json)을 ML 서비스에 연결한다.

  B/barcode_module.py   ReportNoLookup (BAR_CD → PRDLST_REPORT_NO), decode_barcode (pyzbar)
  B/mapping.json        BAR_CD → 품목보고번호 (build_mapping.py 로 생성)
  B/mapping_meta.json   품목보고번호 → [제품명, 제조사, 식품유형] (B/build_meta.py 로 생성, 선택)

이 서비스가 추가로 하는 일
  - 업로드된 사진에서 바코드를 읽을 때 전처리 변형(그레이스케일/대비/업스케일/이진화/회전)을 순서대로 시도
  - 12/13/14자리 표기 차이(UPC-A ↔ EAN-13, GTIN-14) 보정 조회
  - pyzbar(zbar 라이브러리)가 없으면 OpenCV 바코드 검출기로 대체

B 폴더 위치: 환경변수 BARCODE_MODULE_DIR → <repo>/B → /app/B (Docker 볼륨)
"""

from __future__ import annotations

import importlib.util
import io
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from PIL import Image, ImageFilter, ImageOps

import ocr_engine  # load_image 재사용 (EXIF 회전, RGBA 처리, 크기 방어)

VALID_LENGTHS = (8, 12, 13, 14)


def _candidate_dirs() -> List[Path]:
    here = Path(__file__).resolve().parent
    out: List[Path] = []
    env = os.environ.get("BARCODE_MODULE_DIR")
    if env:
        out.append(Path(env))
    out += [here.parent / "B", here / "B", Path("/app/B")]
    return out


def find_module_dir() -> Optional[Path]:
    for d in _candidate_dirs():
        if (d / "barcode_module.py").exists() and (d / "mapping.json").exists():
            return d
    return None


class BarcodeService:
    """B 모듈 래퍼. 매핑은 최초 사용 시 한 번만 로드한다."""

    def __init__(self, module_dir: Optional[Path] = None):
        self._dir = module_dir
        self._lock = threading.Lock()
        self._loaded = False
        self._lut = None
        self._mod = None
        self._meta: Dict[str, list] = {}
        self.error: Optional[str] = None

    # ── 로딩 ────────────────────────────────────────────────
    def _load(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            d = self._dir or find_module_dir()
            if d is None:
                self.error = "B 폴더(barcode_module.py, mapping.json)를 찾을 수 없습니다."
                self._loaded = True
                return
            spec = importlib.util.spec_from_file_location("barcode_module", d / "barcode_module.py")
            mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
            self._mod = mod
            self._lut = mod.ReportNoLookup(str(d / "mapping.json"))
            meta_path = d / "mapping_meta.json"
            if meta_path.exists():
                with open(meta_path, encoding="utf-8") as f:
                    self._meta = json.load(f)
            self._dir = d
            self._loaded = True

    @property
    def ready(self) -> bool:
        self._load()
        return self._lut is not None

    def info(self) -> Dict:
        self._load()
        return {
            "ready": self._lut is not None,
            "mapping_size": len(self._lut) if self._lut is not None else 0,
            "meta_size": len(self._meta),
            "module_dir": str(self._dir) if self._dir else None,
            "error": self.error,
        }

    # ── 조회 ────────────────────────────────────────────────
    @staticmethod
    def code_variants(code: str) -> List[str]:
        """UPC-A(12) ↔ EAN-13, GTIN-14 표기 차이를 흡수한 조회 후보."""
        c = "".join(ch for ch in str(code) if ch.isdigit())
        out = [c]
        if len(c) == 12:
            out.append("0" + c)
        elif len(c) == 13 and c.startswith("0"):
            out.append(c[1:])
        elif len(c) == 14:
            out += [c[1:], c.lstrip("0")]
        seen: List[str] = []
        for v in out:
            if v and v not in seen:
                seen.append(v)
        return seen

    def lookup(self, code: str) -> Dict:
        """바코드 번호 → 제품 정보. status: ok | not_found | unavailable"""
        self._load()
        digits = "".join(ch for ch in str(code) if ch.isdigit())
        if self._lut is None:
            return {"status": "unavailable", "code": digits, "message": self.error}
        for cand in self.code_variants(digits):
            report_no = self._lut.lookup(cand)
            if report_no:
                meta = self._meta.get(report_no) or []
                return {
                    "status": "ok",
                    "code": digits,
                    "matched_code": cand,
                    "report_no": report_no,
                    "product_name": meta[0] if len(meta) > 0 else None,
                    "manufacturer": meta[1] if len(meta) > 1 else None,
                    "food_type": meta[2] if len(meta) > 2 else None,
                }
        return {"status": "not_found", "code": digits}

    # ── 이미지 디코딩 ───────────────────────────────────────
    def decode_image(self, data: bytes) -> Dict:
        """사진에서 바코드를 읽고 제품을 조회한다. status: ok | not_found | decode_failed | unavailable"""
        self._load()
        img = ocr_engine.load_image(data)  # ImageError 는 호출자가 처리
        code = self._decode_with_variants(img, data)
        if not code:
            return {"status": "decode_failed"}
        result = self.lookup(code)
        result.setdefault("code", code)
        return result

    def _decode_with_variants(self, img: Image.Image, original: bytes) -> Optional[str]:
        # 1) B 모듈의 기본 디코더(원본 그대로) — 가장 단순하고 빠름
        code = self._decode_with_b_module(original)
        if code:
            return code
        # 2) 전처리 변형 시도
        for variant in _variants(img):
            code = _decode_pil(variant)
            if code:
                return code
        return None

    def _decode_with_b_module(self, data: bytes) -> Optional[str]:
        if self._mod is None:
            return None
        try:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                Image.open(io.BytesIO(data)).convert("RGB").save(tmp, format="PNG")
                path = tmp.name
            try:
                code = self._mod.decode_barcode(path)
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            return code if code and code.isdigit() and len(code) in VALID_LENGTHS else None
        except Exception:
            return None


# ─────────────────────────────────────────────────────────────
# 이미지 변형 / 디코더
# ─────────────────────────────────────────────────────────────
def _variants(img: Image.Image):
    """바코드 인식률을 높이는 전처리 변형을 순서대로 생성한다 (비용이 작은 것부터)."""
    base = img.convert("L")
    yield base
    yield ImageOps.autocontrast(base, cutoff=1)
    w, h = base.size
    if max(w, h) < 1600:
        up = base.resize((w * 2, h * 2), Image.LANCZOS)
        yield up
        yield ImageOps.autocontrast(up, cutoff=1).filter(ImageFilter.SHARPEN)
    elif max(w, h) > 2400:
        s = 2000 / max(w, h)
        yield base.resize((round(w * s), round(h * s)), Image.LANCZOS)
    # 이진화 (Otsu) — 조명이 고르지 않은 사진
    try:
        import cv2

        arr = np.asarray(ImageOps.autocontrast(base, cutoff=1))
        _t, th = cv2.threshold(arr, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        yield Image.fromarray(th)
        ad = cv2.adaptiveThreshold(arr, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 8)
        yield Image.fromarray(ad)
    except Exception:
        pass
    # 회전 (바코드가 세로로 찍힌 경우)
    for angle in (90, 270, 180):
        yield base.rotate(angle, expand=True, fillcolor=255)


def _decode_pil(img: Image.Image) -> Optional[str]:
    code = _decode_pyzbar(img)
    if code:
        return code
    return _decode_opencv(img)


def _decode_pyzbar(img: Image.Image) -> Optional[str]:
    try:
        from pyzbar.pyzbar import ZBarSymbol, decode
    except Exception:
        return None
    try:
        symbols = [ZBarSymbol.EAN13, ZBarSymbol.EAN8, ZBarSymbol.UPCA, ZBarSymbol.UPCE, ZBarSymbol.ISBN13]
        for r in decode(img, symbols=symbols):
            text = r.data.decode("utf-8", errors="ignore").strip()
            if text.isdigit() and len(text) in VALID_LENGTHS:
                return text
        # 기타 1D 코드(CODE128 등)에 든 숫자 바코드도 허용
        for r in decode(img):
            text = r.data.decode("utf-8", errors="ignore").strip()
            if text.isdigit() and len(text) in VALID_LENGTHS:
                return text
    except Exception:
        return None
    return None


def _decode_opencv(img: Image.Image) -> Optional[str]:
    try:
        import cv2

        det = cv2.barcode.BarcodeDetector()  # OpenCV >= 4.8
        arr = np.asarray(img.convert("L"))
        ok, infos, _types, _pts = det.detectAndDecodeWithType(arr)
        if ok:
            for text in infos:
                if text and text.isdigit() and len(text) in VALID_LENGTHS:
                    return text
    except Exception:
        return None
    return None


_service: Optional[BarcodeService] = None


def get_service() -> BarcodeService:
    global _service
    if _service is None:
        _service = BarcodeService()
    return _service
