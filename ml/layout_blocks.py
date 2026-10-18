"""
layout_blocks.py
- 역할: OCR 줄 좌표(박스)로 "원재료명 문단이 놓인 단(column)"을 찾아 그 문단의 줄만 순서대로 돌려준다.

왜 필요한가
  라벨은 표 구조라 같은 높이에 다른 항목(제조업소명, 영양성분표 조각)이 나란히 놓이는 일이 많다.
  텍스트만 "같은 높이 = 한 줄" 로 이어 붙이면 원재료명 문단이 중간중간 끊기고 다른 항목이 섞인다.
  문단의 왼쪽 경계(x)가 같은 줄들만 모으면 이웃 항목과 섞이지 않는다.

방법
  1) "원재료명" 머리말 박스를 찾는다.
     - 머리말과 본문이 한 박스("원재료명 정제수, 설탕…")면 본문 시작 x 를 글자 비율로 추정한다.
     - 머리말만 있는 박스면 오른쪽 이웃 박스의 왼쪽 x 를 본문 시작으로 본다.
  2) 본문 시작 x 와 왼쪽 경계가 같은 박스를 위아래로 이어(줄 간격 이내) 문단을 만든다.
  3) 같은 행에서 문단 박스 오른쪽에 이어 붙은 조각(검출기가 긴 줄을 반으로 나눈 경우)을 붙인다.
  4) 후보가 여럿이면 원재료명다움(사전 단어 비율)으로 고른다.
"""

from __future__ import annotations

import re
from typing import List, Optional, Sequence, Tuple

import numpy as np

from ingredient_corrector import plausibility
from ocr_engine import OcrLine

_HEADER = re.compile(r"원\s*재\s*료\s*명?|원\s*료\s*명|Ingredients?", re.I)
# 문단 밖의 다음 항목 머리말 (label_parser._ING_STOP 와 같은 취지)
_STOP = re.compile(
    r"^\s*[|•·\-]?\s*(?:영양\s*정보|영양\s*성분|알레르기|알러지|보관\s*방법|주의\s*사항|품목\s*보고|업소명|제조\s*원|"
    r"제조\s*업소|제조\s*판매|판매원|소비\s*기한|유통\s*기한|포장\s*재질|반품|교환|고객|부정\s*불량|"
    r"이\s*제품은|본\s*제품은|※|▶|■|●|▲)"
)
# 같은 행 왼쪽에 이 머리말이 있으면 그 줄은 원재료명이 아니라 다른 항목의 값이다
_OTHER_LABEL = re.compile(
    r"^(?:제\s*품\s*명|식품\s*의?\s*유형|내용량|품목\s*보고\s*번호|업소\s*명|제조\s*원|제조\s*업소|소재\s*지|유통\s*전문\s*판매원|"
    r"판매\s*원|보관\s*방법|포장\s*재질|소비\s*기한|제조\s*일|유통\s*기한|원산지|수입\s*원|영업소)"
)
_NUTRIENT = re.compile(r"(?:나트륨|탄수화물|당류|콜레스테롤|단백질|포화지방|트랜스지방)\s*[:：]?\s*\d")
_PCT_ONLY = re.compile(r"^[\s|\d.,]*%?[\s|]*$")


def _compact(s: str) -> str:
    return re.sub(r"\s+", "", s)


def _looks_ingredient(text: str) -> bool:
    c = _compact(text)
    if len(c) < 2 or _PCT_ONLY.match(text):
        return False
    if _NUTRIENT.search(c):
        return False
    letters = re.sub(r"[\d\W_]+", "", c)
    if not letters:
        return False
    hangul = sum(1 for ch in letters if "가" <= ch <= "힣")
    return hangul / len(letters) >= 0.4


def _chain(sorted_boxes: List[OcrLine], seed: int, max_gap: float, up: bool = True) -> List[OcrLine]:
    """y 순으로 정렬된 박스에서 seed 를 포함해 줄 간격 이내로 이어지는 구간을 돌려준다."""
    lo = hi = seed
    if up:
        while lo > 0 and sorted_boxes[lo].y0 - sorted_boxes[lo - 1].y1 <= max_gap:
            lo -= 1
    while hi + 1 < len(sorted_boxes) and sorted_boxes[hi + 1].y0 - sorted_boxes[hi].y1 <= max_gap:
        hi += 1
    return sorted_boxes[lo: hi + 1]


def _has_other_label(box: OcrLine, boxes: Sequence[OcrLine], med_h: float, skip: OcrLine) -> bool:
    """같은 행 왼쪽에 다른 항목의 머리말("제품명", "제조원" …)이 붙어 있는가."""
    for d in boxes:
        if d is box or d is skip:
            continue
        if abs(d.cy - box.cy) <= 0.6 * med_h and d.x1 <= box.x0 + 0.5 * med_h and _OTHER_LABEL.match(d.text.strip()):
            return True
    return False


def _continuations(box: OcrLine, others: Sequence[OcrLine], med_h: float) -> List[OcrLine]:
    """같은 행에서 box 오른쪽에 바로 이어진 조각(검출기가 긴 줄을 둘로 나눈 경우)."""
    out: List[OcrLine] = []
    cur = box
    for _ in range(3):
        nxt = None
        for d in others:
            if d is cur or d is box or d in out:
                continue
            if abs(d.cy - cur.cy) > 0.6 * med_h:
                continue
            gap = d.x0 - cur.x1
            if -0.5 * med_h <= gap <= 1.2 * med_h and _looks_ingredient(d.text):
                if nxt is None or d.x0 < nxt.x0:
                    nxt = d
        if nxt is None:
            break
        out.append(nxt)
        cur = nxt
    return out


def _paragraph_for(header: OcrLine, boxes: List[OcrLine], med_h: float) -> List[Tuple[str, float, float]]:
    """머리말 하나에서 만든 후보 문단들 [(텍스트, 시작 y, 끝 y)] — 가능한 왼쪽 경계마다 하나."""
    m = _HEADER.search(header.text)
    if not m:
        return []
    rest = header.text[m.end():].strip(" :：|-·")
    tol = 0.6 * med_h  # 문단 줄들의 왼쪽 경계가 이 범위 안이면 같은 단(column)
    max_gap = 1.3 * med_h
    results: List[Tuple[str, float, float]] = []

    others = [b for b in boxes if b is not header]
    others_sorted = sorted(others, key=lambda b: b.y0)

    def build(x_left: float, include_header_line: bool, seed_box: Optional[OcrLine]) -> Optional[Tuple[str, float, float]]:
        aligned = [
            b for b in others_sorted
            if abs(b.x0 - x_left) <= tol and _looks_ingredient(b.text) and not _has_other_label(b, boxes, med_h, header)
        ]
        if include_header_line:
            # 머리말 줄 아래로만 이어 붙인다
            below = [b for b in aligned if b.y0 >= header.y0 + 0.5 * med_h]
            seq = [header] + below
            run = [header]
            for b in below:
                if b.y0 - run[-1].y1 > max_gap:
                    break
                if _STOP.match(b.text):
                    break
                run.append(b)
        else:
            if seed_box is None:
                return None
            seq = sorted(aligned + ([seed_box] if seed_box not in aligned else []), key=lambda b: b.y0)
            idx = seq.index(seed_box)
            run = _chain(seq, idx, max_gap)
            # 문단 밖의 다음 항목 머리말에서 끊는다
            cut = []
            for b in run:
                if b is not seed_box and _STOP.match(b.text) and b.y0 > seed_box.y0:
                    break
                cut.append(b)
            run = cut
        if not run:
            return None
        texts: List[str] = []
        for b in run:
            t = rest if (b is header and include_header_line) else b.text
            if b is header and include_header_line:
                texts.append(f"원재료명 {rest}".strip())
            else:
                texts.append(t)
            for d in _continuations(b, boxes, med_h):
                if d is not header and d not in run:
                    texts[-1] += " " + d.text
        y0, y1 = min(b.y0 for b in run), max(b.y1 for b in run)
        if not include_header_line:
            texts.insert(0, "원재료명")
        return "\n".join(texts), y0, y1

    if len(_compact(rest)) >= 3:
        # 머리말과 본문이 한 박스: 박스 왼쪽 x(여백에서 시작하는 문단) 와, 바로 아래 줄들의 왼쪽 x(셀 안쪽에서
        # 시작하는 문단) 를 후보로 시도한다. 아래 줄의 실제 좌표를 쓰므로 글자 수 비율 같은 추정이 필요 없다.
        edges = [header.x0]
        for b in sorted(others, key=lambda b: b.y0):
            if header.y1 - 0.5 * med_h <= b.y0 <= header.y1 + 2.2 * med_h and b.x0 >= header.x0 - tol                     and _looks_ingredient(b.text):
                if all(abs(b.x0 - e) > tol for e in edges):
                    edges.append(b.x0)
            if len(edges) >= 3:
                break
        for xl in edges:
            r = build(xl, True, None)
            if r:
                results.append(r)
    else:
        # 머리말만 있는 박스(또는 "원재료명 및 함량"): 오른쪽 이웃 박스가 본문 첫 줄
        right = [
            b for b in others
            if b.x0 >= header.x1 - 0.3 * med_h
            and b.y0 - 6 * med_h <= header.cy <= b.y1 + 6 * med_h
            and _looks_ingredient(b.text)
        ]
        # 머리말과 가장 가까운(수평 간격이 작고 수직으로 겹치는) 이웃을 본문 첫 줄로
        right.sort(key=lambda b: (abs(b.cy - header.cy) > 4 * med_h, b.x0 - header.x1, abs(b.cy - header.cy)))
        for seed in right[:2]:
            r = build(seed.x0, False, seed)
            if r:
                results.append(r)
    return results


def ingredient_flow_lines(lines: Sequence[OcrLine]) -> Optional[str]:
    """원재료명 문단이 놓인 단의 줄을 위→아래로 이어 붙인 텍스트. 머리말을 찾지 못하면 None."""
    boxes = [l for l in lines if l.text and l.text.strip()]
    if len(boxes) < 4:
        return None
    med_h = float(np.median([b.height for b in boxes])) or 10.0
    headers = sorted((b for b in boxes if _HEADER.search(b.text)), key=lambda b: b.y0)
    if not headers:
        return None

    best: Optional[Tuple[float, str]] = None
    for h in headers[:3]:
        for text, _y0, _y1 in _paragraph_for(h, boxes, med_h):
            score = plausibility(text)
            if best is None or score > best[0]:
                best = (score, text)
    return best[1] if best and best[0] > 0 else None
