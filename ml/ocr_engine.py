"""
ocr_engine.py
- 역할: 이미지(바이트) → 텍스트 줄 목록(OcrLine). OCR 엔진 래퍼 + 전처리.
- 엔진: RapidOCR (ONNX Runtime, PP-OCRv5 한국어 인식 모델). CPU 만으로 동작하며
        모델은 최초 실행 시 내려받는다(Docker 빌드 시 warmup() 으로 미리 받아 둔다).
- 호출자: label_service.py / checkup_service.py (파서는 엔진과 독립적으로 텍스트만 입력받는다)

전처리 요약
  1. EXIF 회전 반영, RGBA → 흰 배경 RGB, 과도하게 큰 이미지 축소(폭탄 이미지 방어)
  2. 작은 이미지는 업스케일 + 대비 보정 (작은 글씨 인식률↑)
  3. 세로로 아주 긴 이미지(상세페이지 캡처 등)는 글자가 잘리지 않도록 빈 행에서 타일 분할
  4. 인식된 키워드가 없으면 90°/270°/180° 회전도 시도 (사진이 옆으로 찍힌 경우)
"""

from __future__ import annotations

import io
import os
import re
import threading
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageFilter, ImageOps

# 압축 폭탄(매우 큰 해상도) 방어
Image.MAX_IMAGE_PIXELS = 60_000_000

MAX_SIDE = int(os.environ.get("OCR_MAX_SIDE", "2600"))      # 이 이상은 축소
TARGET_WIDTH = int(os.environ.get("OCR_TARGET_WIDTH", "1400"))  # 이보다 좁으면 업스케일
MAX_UPSCALE = 3.0
TILE_HEIGHT = int(os.environ.get("OCR_TILE_HEIGHT", "1800"))
TILE_SEARCH = 200  # 타일 경계를 찾는 탐색 폭(px)
MIN_SCORE = float(os.environ.get("OCR_MIN_SCORE", "0.45"))
# 영양성분표 영역 확대 재인식. 방향 분류기(use_cls)를 끈 뒤로는 정확도 이득이 없어(94.5% vs 94.6%) 기본 꺼짐.
REFINE_TABLE = os.environ.get("OCR_REFINE_TABLE", "0") == "1"
USE_CLS = os.environ.get("OCR_USE_CLS", "0") == "1"  # 줄 단위 180° 방향 분류기 (기본 끔, 위 설명 참고)

# 라벨 사진인지 판단하는 키워드 (회전 구조/타일 결과 평가에 사용)
LABEL_KEYWORDS = (
    "영양", "나트륨", "탄수화물", "단백질", "지방", "당류", "열량", "원재료", "kcal",
    "알레르기", "함유", "내용량", "품목보고", "식품유형", "제조",
)


class ImageError(ValueError):
    """이미지를 열 수 없거나 형식이 지원되지 않을 때."""


@dataclass
class OcrLine:
    text: str
    score: float
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2.0

    @property
    def height(self) -> float:
        return max(1.0, self.y1 - self.y0)


@dataclass
class OcrResult:
    lines: List[OcrLine] = field(default_factory=list)
    width: int = 0
    height: int = 0
    rotation: int = 0

    @property
    def text(self) -> str:
        """엔진이 읽은 순서대로 이어 붙인 텍스트(문장 해석용)."""
        return "\n".join(l.text for l in self.lines)

    @property
    def avg_score(self) -> float:
        if not self.lines:
            return 0.0
        total = sum(len(l.text) for l in self.lines) or 1
        return sum(l.score * len(l.text) for l in self.lines) / total

    def layout_text(self) -> str:
        """같은 높이의 조각을 한 줄로 묶은 텍스트 (표 해석용)."""
        return layout_lines(self.lines)

    def reading_text(self) -> str:
        """다단/블록 구조를 고려한 읽기 순서 텍스트 (원재료명 같은 문단 해석용)."""
        return "\n".join(l.text for l in reading_order(self.lines))


# ─────────────────────────────────────────────────────────────
# 행 복원: 같은 높이의 조각을 한 줄로 묶는다(표의 "나트륨 | 75 mg | 4%" 복원)
# ─────────────────────────────────────────────────────────────
def layout_lines(lines: Sequence[OcrLine], gap_ratio: float = 1.5) -> str:
    if not lines:
        return ""
    med_h = float(np.median([l.height for l in lines])) or 10.0
    ordered = sorted(lines, key=lambda l: l.cy)
    rows: List[List[OcrLine]] = []
    cur = [ordered[0]]
    for l in ordered[1:]:
        mean_cy = float(np.mean([c.cy for c in cur]))
        if abs(l.cy - mean_cy) > 0.6 * med_h:
            rows.append(cur)
            cur = [l]
        else:
            cur.append(l)
    rows.append(cur)

    out = []
    for row in rows:
        row.sort(key=lambda l: l.x0)
        s = row[0].text
        for a, b in zip(row, row[1:]):
            s += (" | " if b.x0 - a.x1 > gap_ratio * med_h else " ") + b.text
        out.append(s)
    return "\n".join(out)


# ─────────────────────────────────────────────────────────────
# 읽기 순서: 재귀적 XY-cut (단/블록 단위로 위→아래, 왼쪽→오른쪽)
# ─────────────────────────────────────────────────────────────
def _gaps(intervals: List[Tuple[float, float]], min_gap: float) -> List[float]:
    """투영 구간 목록에서 min_gap 이상 비어 있는 지점(중앙)을 반환한다."""
    if not intervals:
        return []
    ivs = sorted(intervals)
    cuts: List[float] = []
    end = ivs[0][1]
    for a, b in ivs[1:]:
        if a - end >= min_gap:
            cuts.append((a + end) / 2.0)
        end = max(end, b)
    return cuts


def reading_order(lines: Sequence[OcrLine], _depth: int = 0) -> List[OcrLine]:
    lines = list(lines)
    if len(lines) <= 2 or _depth > 8:
        return sorted(lines, key=lambda l: (round(l.cy / max(l.height, 1.0)), l.x0))
    med_h = float(np.median([l.height for l in lines])) or 10.0

    # 1) 위/아래 블록 분리 (행 사이가 충분히 비어 있을 때)
    ycuts = _gaps([(l.y0, l.y1) for l in lines], 1.0 * med_h)
    if ycuts:
        cut = ycuts[0]
        top = [l for l in lines if l.cy < cut]
        bottom = [l for l in lines if l.cy >= cut]
        if top and bottom:
            return reading_order(top, _depth + 1) + reading_order(bottom, _depth + 1)

    # 2) 좌/우 단 분리 (세로 여백이 충분히 클 때)
    xcuts = _gaps([(l.x0, l.x1) for l in lines], 2.5 * med_h)
    if xcuts:
        cut = xcuts[0]
        left = [l for l in lines if (l.x0 + l.x1) / 2.0 < cut]
        right = [l for l in lines if (l.x0 + l.x1) / 2.0 >= cut]
        if left and right:
            return reading_order(left, _depth + 1) + reading_order(right, _depth + 1)

    # 3) 더 나눌 수 없음 — 같은 행끼리 왼쪽→오른쪽
    return sorted(lines, key=lambda l: (round(l.cy / med_h), l.x0))


# ─────────────────────────────────────────────────────────────
# 이미지 로딩/전처리
# ─────────────────────────────────────────────────────────────
def load_image(data: bytes) -> Image.Image:
    if not data:
        raise ImageError("이미지가 비어 있습니다.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # PIL 은 형식별로 다양한 예외를 던진다
        raise ImageError("이미지를 읽을 수 없습니다. JPG/PNG 형식의 사진을 사용해 주세요.") from exc

    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, "white")
        bg.paste(rgba, mask=rgba.split()[3])
        img = bg
    if min(img.size) < 16:
        raise ImageError("이미지가 너무 작습니다.")
    return img


def _prepare(img: Image.Image) -> Image.Image:
    w, h = img.size
    longest = max(w, h)
    if longest > MAX_SIDE:
        scale = MAX_SIDE / longest
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        w, h = img.size
    scale = min(MAX_UPSCALE, max(1.0, TARGET_WIDTH / w))
    if scale > 1.05:
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    img = ImageOps.autocontrast(img, cutoff=0.5)
    if scale > 1.2:  # 업스케일로 흐려진 글자 윤곽 보정
        img = img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=3))
    return img


def _split_tiles(img: Image.Image) -> List[Tuple[Image.Image, int]]:
    """세로로 긴 이미지를 빈 행 기준으로 분할. [(tile, y_offset)]"""
    w, h = img.size
    if h <= TILE_HEIGHT * 1.25:
        return [(img, 0)]
    gray = np.asarray(img.convert("L"), dtype=np.float32)
    tiles: List[Tuple[Image.Image, int]] = []
    y0 = 0
    while y0 < h:
        y1 = y0 + TILE_HEIGHT
        if y1 >= h - TILE_SEARCH:
            y1 = h
        else:
            lo, hi = y1 - TILE_SEARCH, y1 + TILE_SEARCH
            y1 = lo + int(np.argmin(gray[lo:hi].std(axis=1)))  # 가장 균일한(빈) 행
        if y1 - y0 >= 40:
            tiles.append((img.crop((0, y0, w, y1)), y0))
        y0 = max(y1, y0 + 1)
    return tiles


# ─────────────────────────────────────────────────────────────
# 엔진 (지연 로딩 + 스레드 보호)
# ─────────────────────────────────────────────────────────────
_engines: dict = {}
_engine_lock = threading.Lock()
# 실험/튜닝용 RapidOCR 파라미터 덮어쓰기 (예: {"Det.box_thresh": 0.4}) — "ko" 엔진에만 적용
EXTRA_PARAMS: dict = {}


class OcrEngineError(RuntimeError):
    """OCR 엔진 내부 오류(메모리 부족 등). 호출자는 사용자에게 재시도를 안내한다."""


def reset_engine() -> None:
    _engines.clear()


def _get_engine(kind: str = "ko"):
    """kind: "ko"(한국어 PP-OCRv5, 기본) | "latin"(PP-OCRv6 다국어 — LDL/HDL, mg/dL 같은 영문·숫자 줄 보강)"""
    if kind not in _engines:
        with _engine_lock:
            if kind not in _engines:
                from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR

                # 텍스트 방향 분류기(use_cls)는 끈다. 표의 짧은 숫자 줄("7 g", "8 g", "1g 미만")을
                # 180° 뒤집힌 글자로 오판해 "7g"→"6∠", "8g"→"68" 처럼 거꾸로 읽는 일이 잦았다.
                # 사진 전체가 돌아간 경우는 read_image 의 회전 후보 탐색이 따로 처리한다.
                params = {"Global.log_level": "warning", "Global.use_cls": USE_CLS}
                if kind == "ko":
                    params.update(
                        {
                            "Rec.lang_type": LangRec.KOREAN,
                            "Rec.ocr_version": OCRVersion.PPOCRV5,
                            "Rec.model_type": ModelType.MOBILE,
                        }
                    )
                    # 검출 모델 크기: small(기본, 빠름) | medium(약 +1~2% 정확도, 약 1.3배 느림)
                    det_size = os.environ.get("OCR_DET_MODEL", "small").lower()
                    if det_size in ("tiny", "medium"):
                        params["Det.model_type"] = ModelType.MEDIUM if det_size == "medium" else ModelType.TINY
                    params.update(EXTRA_PARAMS)
                elif kind == "latin":
                    params.update(
                        {
                            "Rec.lang_type": LangRec.CH,
                            "Rec.ocr_version": OCRVersion.PPOCRV6,
                            "Rec.model_type": ModelType.SMALL,
                        }
                    )
                else:
                    raise ValueError(f"unknown OCR engine kind: {kind}")
                _engines[kind] = RapidOCR(params=params)
    return _engines[kind]


def warmup(kinds: Sequence[str] = ("ko", "latin")) -> None:
    """모델 파일을 미리 내려받고 로드한다 (Docker 빌드/서비스 시작 시 호출)."""
    blank = np.full((64, 256, 3), 255, dtype=np.uint8)
    for kind in kinds:
        _get_engine(kind)(blank)


def _run_engine(arr: np.ndarray, y_offset: int = 0, kind: str = "ko") -> List[OcrLine]:
    engine = _get_engine(kind)
    res = None
    for attempt in (1, 2):
        try:
            with _engine_lock:  # onnxruntime 세션 공유 — 동시 호출 직렬화
                res = engine(np.ascontiguousarray(arr))
            break
        except Exception as exc:  # noqa: BLE001  (OpenCV/ONNX 내부 예외는 종류가 다양하다)
            if attempt == 2:
                raise OcrEngineError("이미지를 처리하는 중 오류가 발생했습니다.") from exc
            import gc

            gc.collect()  # 메모리 부족으로 인한 일시 오류일 수 있어 정리 후 한 번 재시도
    if res is None or res.txts is None or len(res.txts) == 0:
        return []
    out: List[OcrLine] = []
    for box, txt, score in zip(res.boxes, res.txts, res.scores):
        text = str(txt).strip()
        if not text or float(score) < MIN_SCORE:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        out.append(OcrLine(text, float(score), min(xs), min(ys) + y_offset, max(xs), max(ys) + y_offset))
    return out


def _overlap_ratio(a: OcrLine, b: OcrLine) -> float:
    """두 박스가 겹친 넓이를 더 작은 박스 넓이로 나눈 값 (0~1)."""
    iw = min(a.x1, b.x1) - max(a.x0, b.x0)
    ih = min(a.y1, b.y1) - max(a.y0, b.y0)
    if iw <= 0 or ih <= 0:
        return 0.0
    small = min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))
    return (iw * ih) / small if small > 0 else 0.0


def merge_line_sets(primary: Sequence[OcrLine], extra: Sequence[OcrLine],
                    extra_min_score: float = 0.6, overlap: float = 0.5) -> List[OcrLine]:
    """같은 이미지를 다른 조건(반전 등)으로 읽은 두 결과를 합친다.

    - 박스가 겹치면 같은 글자 영역으로 보고 "점수 × 글자 수" 가 큰 쪽 하나만 남긴다.
      (한쪽이 "6∠"(0.62) 로 오독한 줄을 다른 쪽의 "단백질7g"(0.97) 가 대체한다)
    - 겹치지 않는 extra 줄은 점수가 extra_min_score 이상일 때만 추가한다(반전 이미지의 잡음 방지).
    """
    def quality(l: OcrLine) -> float:
        return l.score * len(l.text.replace(" ", ""))

    out: List[OcrLine] = []
    cands = [(quality(l), 0, l) for l in primary] + [(quality(l), 1, l) for l in extra]
    cands.sort(key=lambda t: (-t[0], t[1]))
    for q, src, l in cands:
        if src == 1 and l.score < extra_min_score:
            # 겹치는 primary 가 있으면 어차피 버려지고, 없으면 신뢰도가 낮아 추가하지 않는다
            continue
        if any(_overlap_ratio(l, k) >= overlap for k in out):
            continue
        out.append(l)
    return out


def _keyword_hits(lines: Sequence[OcrLine]) -> int:
    blob = " ".join(l.text for l in lines)
    return sum(1 for k in LABEL_KEYWORDS if k in blob)


NUTRIENT_WORDS = ("나트륨", "탄수화물", "당류", "지방", "콜레스", "단백", "열량", "kcal")


def _nutrient_hits(lines: Sequence[OcrLine]) -> int:
    blob = "".join(l.text.replace(" ", "") for l in lines)
    return sum(1 for w in NUTRIENT_WORDS if w in blob)


def _refine_nutrition_region(img: Image.Image, lines: List[OcrLine]) -> List[OcrLine]:
    """영양성분표 영역만 잘라 크게 확대해 한 번 더 인식한다.

    작은 표 글씨는 전체 이미지 한 번으로는 마지막 행(단백질 등)이 빠지는 경우가 많다.
    첫 인식에서 영양소 이름이 2개 이상 보이면 그 주변을 잘라 확대 인식하고,
    영양소 단어가 더 많이 읽힌 쪽을 채택한다.
    """
    hits = [l for l in lines if any(w in l.text.replace(" ", "") for w in NUTRIENT_WORDS)]
    if len(hits) < 2:
        return lines
    med_h = float(np.median([l.height for l in hits])) or 20.0
    W, H = img.size
    x0 = max(0.0, min(l.x0 for l in hits) - 1.2 * med_h)
    x1 = min(float(W), max(l.x1 for l in hits) + 1.2 * med_h)
    y0 = max(0.0, min(l.y0 for l in hits) - 1.5 * med_h)
    # 마지막 행(단백질)이 검출되지 않았을 수 있으므로 아래쪽 여유를 둔다
    y1 = min(float(H), max(l.y1 for l in hits) + 3.0 * med_h)
    if x1 - x0 < 60 or y1 - y0 < 40:
        return lines

    crop = img.crop((round(x0), round(y0), round(x1), round(y1)))
    scale = min(3.0, max(1.0, 1500.0 / crop.width), 3000.0 / max(crop.height, 1))
    if scale < 1.15:
        return lines
    big = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.LANCZOS)
    big = ImageOps.autocontrast(big, cutoff=0.5).filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=3))
    new_lines = _run_engine(np.asarray(big))
    if _nutrient_hits(new_lines) <= _nutrient_hits(hits):
        return lines

    mapped = [
        OcrLine(l.text, l.score, l.x0 / scale + x0, l.y0 / scale + y0, l.x1 / scale + x0, l.y1 / scale + y0)
        for l in new_lines
    ]
    inside = lambda l: x0 <= (l.x0 + l.x1) / 2 <= x1 and y0 <= l.cy <= y1  # noqa: E731
    kept = [l for l in lines if not inside(l)]
    return kept + mapped


def _read_tiles(img: Image.Image, kind: str) -> List[OcrLine]:
    lines: List[OcrLine] = []
    for tile, y_off in _split_tiles(img):
        lines.extend(_run_engine(np.asarray(tile), y_off, kind))
    return lines


def _ocr_image(img: Image.Image, kind: str = "ko") -> OcrResult:
    prepared = _prepare(img)
    lines = _read_tiles(prepared, kind)
    if REFINE_TABLE and kind == "ko":
        lines = _refine_nutrition_region(prepared, lines)
    lines.sort(key=lambda l: (round(l.cy / 4), l.x0))
    return OcrResult(lines=lines, width=prepared.size[0], height=prepared.size[1])


def read_image(data: bytes, *, rotation_rescue: bool = True, kind: str = "ko") -> OcrResult:
    """이미지 바이트 → OcrResult. 라벨 키워드가 하나도 없으면 회전 후보도 시도한다."""
    img = load_image(data)
    best = _ocr_image(img, kind)
    best.rotation = 0
    if rotation_rescue and _keyword_hits(best.lines) == 0:
        for angle in (90, 270, 180):
            cand = _ocr_image(img.rotate(angle, expand=True, fillcolor="white"), kind)
            cand.rotation = angle
            if (_keyword_hits(cand.lines), cand.avg_score) > (_keyword_hits(best.lines), best.avg_score):
                best = cand
            if _keyword_hits(best.lines) >= 3:
                break
    return best


def invert_pass(data: bytes, primary: OcrResult) -> OcrResult:
    """색을 뒤집은 이미지를 한 번 더 읽어 primary 결과와 합친다. (2차 패스)

    파란/검정 배경의 흰 글씨는 검출 모델이 문단째 놓치는 일이 많다. 반전 이미지에서는 이런 글자가 검출된다.
    박스가 겹치면 점수 × 글자 수가 큰 쪽을 남긴다(merge_line_sets).
    """
    img = load_image(data)
    if primary.rotation:
        img = img.rotate(primary.rotation, expand=True, fillcolor="white")
    prepared = _prepare(img)
    inv_lines = _read_tiles(ImageOps.invert(prepared), "ko")
    lines = merge_line_sets(primary.lines, inv_lines)
    lines.sort(key=lambda l: (round(l.cy / 4), l.x0))
    return OcrResult(lines=lines, width=prepared.size[0], height=prepared.size[1], rotation=primary.rotation)


def combine_results(results: Sequence[OcrResult]) -> OcrResult:
    """같은 제품의 여러 장(영양정보면 + 원재료면)을 한 결과로 합친다. 줄은 장 단위로 이어 붙인다."""
    merged = OcrResult()
    y_cursor = 0.0
    for r in results:
        for l in r.lines:
            merged.lines.append(OcrLine(l.text, l.score, l.x0, l.y0 + y_cursor, l.x1, l.y1 + y_cursor))
        y_cursor += float(r.height) + 200.0  # 장 사이 여백으로 행이 섞이지 않게
        merged.width = max(merged.width, r.width)
        merged.height = int(y_cursor)
        if r.rotation and not merged.rotation:
            merged.rotation = r.rotation
    return merged


def read_images(blobs: Sequence[bytes]) -> OcrResult:
    """같은 제품의 여러 장을 읽어 한 결과로 합친다. (기본 패스만)"""
    return combine_results([read_image(blob) for blob in blobs])


def normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()
