"""
ocr_pipeline.py
- 역할: 이미지 → OCR → 파서 를 이어 붙이는 서비스 계층 (FastAPI 엔드포인트가 호출).
"""

from __future__ import annotations

import os
from typing import Dict, List, Sequence

import layout_blocks
import ocr_engine
from checkup_parser import parse_checkup
from ingredient_corrector import known_ratio, plausibility
from label_parser import parse_label


def _compact_len(text) -> int:
    return len((text or "").replace(" ", ""))


# 색 반전 2차 패스: auto(필요할 때만) | always | off
INVERT_PASS = os.environ.get("OCR_INVERT_PASS", "auto").lower()
# 표에 있어야 하는 영양소 이름 — 하나라도 OCR 결과에 없으면 읽기가 불충분한 것으로 본다
_EXPECTED_NAMES = ("나트륨", "탄수화물", "당류", "지방", "트랜스", "포화", "콜레스", "단백")
_MIN_KNOWN_RATIO = 0.6  # 원재료명 글자 중 사전에 있는 단어 비율이 이보다 낮으면 2차 패스를 시도


def _needs_second_pass(result: "ocr_engine.OcrResult", parsed: Dict) -> bool:
    if INVERT_PASS == "off":
        return False
    if INVERT_PASS == "always":
        return True
    blob = "".join(l.text.replace(" ", "") for l in result.lines)
    if any(w not in blob for w in _EXPECTED_NAMES):
        return True
    ing = parsed.get("ingredients") or ""
    return (not ing) or known_ratio(ing) < _MIN_KNOWN_RATIO


def _candidate_score(parsed: Dict) -> float:
    filled = sum(
        1 for k in ("energy_kcal", "sodium_mg", "carbohydrate_g", "sugar_g", "fat_g", "protein_g")
        if parsed["nutrition"].get(k) is not None
    )
    return 20.0 * filled + plausibility(parsed.get("ingredients") or "")


def analyze_label_images(blobs: Sequence[bytes]) -> Dict:
    """식품 라벨 사진(1~4장) → 구조화 결과.

    영양성분표와 원재료명이 서로 다른 면에 있어도 함께 넘기면 하나의 결과로 합친다.

    1차: 기본 패스로 읽고 파싱한다.
    2차: 결과가 불충분하면(영양소 이름 누락, 원재료명 없음/불명확) 색을 뒤집어 다시 읽고 합쳐 파싱한 뒤,
         두 후보 중 "채워진 핵심 영양소 수 + 원재료명다움" 점수가 높은 쪽을 쓴다.
    """
    blobs = list(blobs)
    results = [ocr_engine.read_image(b) for b in blobs]
    combined = ocr_engine.combine_results(results)
    parsed = parse_ocr_result(combined)
    used_second = False

    if _needs_second_pass(combined, parsed):
        results2 = [ocr_engine.invert_pass(b, r) for b, r in zip(blobs, results)]
        combined2 = ocr_engine.combine_results(results2)
        parsed2 = parse_ocr_result(combined2)
        if _candidate_score(parsed2) >= _candidate_score(parsed):
            parsed, combined, used_second = parsed2, combined2, True

    parsed["ocr"] = {
        "lines": len(combined.lines),
        "avg_score": round(combined.avg_score, 3),
        "rotation": combined.rotation,
        "images": len(blobs),
        "second_pass": used_second,
    }
    return parsed


def parse_ocr_result(result: "ocr_engine.OcrResult") -> Dict:
    """OCR 줄 목록 → 구조화 결과. (이미지 없이도 호출 가능 — 평가 도구가 같은 경로를 그대로 쓴다)

    원재료명/알레르기 문구는 읽기 방식에 따라 결과가 달라서 후보를 여럿 만들어 고른다.
      layout : 같은 높이의 조각을 한 줄로 (표 해석에 유리)
      reading: 단/블록 단위 읽기 순서 (XY-cut)
      column : "원재료명" 머리말이 있는 문단의 단(column)만 좌표로 모은 것 (표 안의 문단에 유리)
    원재료명은 사전 기반 "원재료명다움" 점수가 가장 높은 후보를, 알레르기 문구는 가장 길게 읽힌 쪽을 쓴다.
    """
    layout = result.layout_text()
    parsed = parse_label(layout, flow_text=layout, avg_ocr_score=result.avg_score)
    candidates = [parsed]

    reading = result.reading_text()
    alt = None
    if reading and reading != layout:
        alt = parse_label(layout, flow_text=reading, avg_ocr_score=result.avg_score)
        candidates.append(alt)

    column_text = layout_blocks.ingredient_flow_lines(result.lines)
    column = None
    if column_text:
        column = parse_label(layout, flow_text=column_text, avg_ocr_score=result.avg_score)
        candidates.append(column)

    def ing_key(c: Dict):
        text = c.get("ingredients") or ""
        return (plausibility(text), _compact_len(text))

    best = max(candidates, key=ing_key)
    if best is not parsed:
        parsed["ingredients"] = best["ingredients"]
        parsed["ingredient_corrections"] = best.get("ingredient_corrections", [])
        # 원재료명 끝에 붙은 "우유 함유" 같은 문구는 선택된 후보에서만 분리되므로 함께 가져온다
        parsed["allergy_text"] = _merge_lines(parsed.get("allergy_text"), best.get("allergy_text"))
    for c in (alt,):  # column 후보는 문단 밖의 알레르기 문구를 담지 못하므로 제외
        if c and _compact_len(c.get("allergy_text")) > _compact_len(parsed.get("allergy_text")):
            parsed["allergy_text"] = c["allergy_text"]
    return parsed


def _merge_lines(a: "str | None", b: "str | None") -> "str | None":
    """줄 단위로 중복 없이 합친다."""
    seen: List[str] = []
    for text in (a, b):
        for line in (text or "").split("\n"):
            line = line.strip()
            if line and line not in seen:
                seen.append(line)
    return "\n".join(seen) or None


def analyze_checkup_image(blob: bytes) -> Dict:
    """건강검진 결과지 사진 → 프로필 수치.

    결과지에는 LDL/HDL, mg/dL 같은 영문·숫자 항목이 많아 한국어 모델만으로는 이런 줄을 놓치는 일이 잦다.
    한국어 모델 결과에 다국어(영문/숫자 보강) 모델 결과를 이어 붙여 파서가 둘 다 볼 수 있게 한다.
    """
    ko = ocr_engine.read_image(blob)
    texts = [ko.layout_text(), ko.text]
    avg = ko.avg_score
    rotation = ko.rotation
    try:
        latin = ocr_engine.read_image(blob, rotation_rescue=False, kind="latin")
        texts += [latin.layout_text()]
    except ocr_engine.OcrEngineError:
        pass  # 보강 모델 실패는 치명적이지 않다
    parsed = parse_checkup("\n".join(t for t in texts if t), avg_ocr_score=avg)
    parsed["ocr"] = {
        "lines": len(ko.lines),
        "avg_score": round(avg, 3),
        "rotation": rotation,
    }
    return parsed
