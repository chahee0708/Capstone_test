"""
label_parser.py
- 역할: 식품 라벨 OCR 텍스트 → 구조화(영양성분/기준량/원재료명/알레르기 문구/제품 정보)
- 특징: OCR 엔진과 독립적(텍스트만 입력). 공백이 끼거나 빠진 한국어 OCR 출력을 전제로
        "공백 제거한 텍스트"에서 이름+숫자+단위 패턴을 찾는다.

출력(dict) 계약은 backend/routes/ocr.js 의 shapeLabelResult 와 일치해야 한다.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Dict, List, Optional, Tuple

from ingredient_corrector import correct as _correct_ingredients

NUTRIENT_KEYS = [
    "energy_kcal", "sodium_mg", "carbohydrate_g", "sugar_g", "fat_g", "trans_fat_g",
    "saturated_fat_g", "cholesterol_mg", "protein_g", "dietary_fiber_g", "potassium_mg", "phosphorus_mg",
]

NUTRIENT_LABEL_KO = {
    "energy_kcal": "열량", "sodium_mg": "나트륨", "carbohydrate_g": "탄수화물", "sugar_g": "당류",
    "fat_g": "지방", "trans_fat_g": "트랜스지방", "saturated_fat_g": "포화지방",
    "cholesterol_mg": "콜레스테롤", "protein_g": "단백질", "dietary_fiber_g": "식이섬유",
    "potassium_mg": "칼륨", "phosphorus_mg": "인",
}

def _fz(name: str) -> str:
    """이름 + 한 글자 치환/탈락 오독 변형을 허용하는 정규식 대안 문자열.

    예) 콜레스테롤 → 콜레스테롤|[가-힣]레스테롤|콜[가-힣]스테롤|… |콜스테롤|…
    OCR 은 "콜레스테롤" 을 "콜레스테를", "플레스테롤", "콜레스태롤" 처럼 한 글자씩 틀리게 읽는 일이 많다.
    4글자 이상 이름만 치환/탈락을 허용한다(짧은 이름은 오탐이 많다).
    """
    alts = [name]
    sub = "[가-힣A-Za-z]"  # 한글을 영문자로("나트륨"→"L트륨") 읽는 경우도 있다
    if len(name) >= 4:
        for i in range(len(name)):
            alts.append(name[:i] + sub + name[i + 1:])
            alts.append(name[:i] + name[i + 1:])
    elif len(name) == 3:
        for i in range(len(name)):
            alts.append(name[:i] + sub + name[i + 1:])
    return "|".join(alts)


# (키, 이름 정규식(공백 제거 기준), 기본 단위, 허용 상한)
# 주의: 구체적인(긴) 이름을 먼저 둔다 — "트랜스지방"/"포화지방" 이 "지방" 보다 앞서 평가되어야 한다.
_NAMES = [
    ("sodium_mg", _fz("나트륨") + r"|나트", "mg", 20000),
    ("carbohydrate_g", _fz("탄수화물") + r"|수화물", "g", 1000),
    ("sugar_g", r"총당류|당류|당루|당튜", "g", 1000),
    ("trans_fat_g", _fz("트랜스지방") + r"|트랜스", "g", 200),
    ("saturated_fat_g", _fz("포화지방") + r"|포화", "g", 500),
    ("fat_g", r"(?<![가-힣])지방", "g", 1000),
    ("cholesterol_mg", _fz("콜레스테롤") + r"|콜레스|레스테|스테롤|스테를", "mg", 5000),
    ("protein_g", _fz("단백질") + r"|단백|(?<![가-힣])백질", "g", 1000),
    ("dietary_fiber_g", _fz("식이섬유"), "g", 500),
    ("potassium_mg", r"칼륨", "mg", 20000),
    ("phosphorus_mg", r"(?<![가-힣])인(?=\d)", "mg", 20000),
]

_NUM = r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)"
# 단위 "g" 를 OCR 이 숫자로 읽은 흔한 글자 (g → 9, 8, 0)
_G_MISREAD = "980"
_UNIT_MASS = r"(mg|㎎|g|kg|㎏|mcg|μg|µg)"

# 영양소 이름 사이의 "다음 이름" 경계 (값 탐색 구간을 자르는 데 사용)
_ANY_NAME = re.compile(
    "|".join(
        [
            r"나트륨", r"탄수화물", r"당류", r"트랜스지방", r"포화지방", r"(?<![트포불])지방",
            r"콜레스테롤", r"단백질", r"식이섬유", r"칼륨", r"열량", r"1일영양성분", r"영양성분기준치",
        ]
    )
)


def _nfkc(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = s.replace("㎎", "mg").replace("㎏", "kg").replace("㎖", "ml").replace("ℓ", "L")
    return s


def compact(s: str) -> str:
    """모든 공백/제어문자를 제거한 비교용 문자열."""
    return re.sub(r"[\s​ ]+", "", _nfkc(s))


_UNIT_FIXES = [
    # "Omg" → "0mg", "Og" → "0g" (숫자 0 을 영문 O 로 읽은 경우)
    (re.compile(r"(?<![A-Za-z])[Oo](?=(?:mg|kcal|g)(?![a-z]))"), "0"),
    (re.compile(r"(?<=\d)(?:m9|mq|rng|rnq|ma)(?![a-z])", re.I), "mg"),
    (re.compile(r"(?<=\d)(?:kall|kca1|kcaI|kcai|kcl|kca|kal|Kcal|KCAL)(?![a-z])"), "kcal"),
    (re.compile(r"(?<=\d)(?:mI|m1|rnl|mL|ML)(?![a-z])"), "ml"),
    # 영양소 이름 바로 뒤의 "이g", "Cg", "Og" → "0g" (숫자 0 을 한글 '이'/영문으로 읽은 경우)
    (re.compile(r"(지방|단백질|당류|탄수화물|콜레스테롤|콜레스테를)[이CcOoQ○](?=(?:mg|g)(?![a-z]))"), r"\g<1>0"),
    # 숫자 1 을 소문자 l / 대문자 I 로 읽은 경우: "lg", "Img" → "1g", "1mg" (영문 단어 끝은 제외)
    (re.compile(r"(?<![A-Za-z0-9.])[lI|](?=(?:mg|g)(?![a-z]))"), "1"),
]

# "1g 미만", "0.5g 미만", "5mg 미만" — 값 뒤에 붙는 "미만/이하" 표기. OCR 은 "미만"을 "이만/마만/미반" 처럼도 읽는다.
_LT_AFTER = re.compile(r"[|:\s]{0,2}(?:미[만반맘민안]|이만|마만)")
# 미만 기준값으로 쓰이는 값들 — "19미만"(1g 의 g 를 9 로 오독)처럼 단위가 9 로 붙은 값을 되돌리는 데 쓴다
_LT_BOUNDS = (0.1, 0.2, 0.3, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0)


def fix_units(c: str) -> str:
    """숫자 뒤에 붙은 흔한 단위 오독(m9→mg, kall→kcal …)을 바로잡는다."""
    for pat, rep in _UNIT_FIXES:
        c = pat.sub(rep, c)
    return c


def _clean_lines(text: str) -> List[str]:
    lines = [_nfkc(l).strip() for l in (text or "").replace("\r", "").split("\n")]
    return [l for l in lines if l]


def _to_float(raw: str) -> Optional[float]:
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


# ─────────────────────────────────────────────────────────────
# 1) 영양성분
# ─────────────────────────────────────────────────────────────
_HEADING_RE = re.compile(r"영양정보|영양성분|영양\s*정보|영양성분표|NutritionFacts|Nutrition", re.I)


def _nutrition_start(c: str) -> int:
    """영양성분표 시작 위치(공백 제거 텍스트 기준). 없으면 -1."""
    best = -1
    for m in re.finditer(r"영양정보|영양성분|영양성분표|영양사실|NutritionFacts", c, re.I):
        # "1일영양성분기준치" 문구는 표 아래 각주이므로 제외
        before = c[max(0, m.start() - 2): m.start()]
        if before.endswith("일") or c[m.start(): m.start() + 9].startswith("영양성분기준치"):
            continue
        best = m.start()
        break
    return best


# 1일 영양성분 기준치(식약처, 2,000kcal 기준) — 값과 "%" 가 함께 인쇄되는 라벨에서
# OCR 이 소수점/단위(g→9)를 잘못 읽은 값을 교차 검증하는 데 사용한다.
DAILY_VALUE = {
    "sodium_mg": 2000.0, "carbohydrate_g": 324.0, "sugar_g": 100.0, "fat_g": 54.0,
    "saturated_fat_g": 15.0, "cholesterol_mg": 300.0, "protein_g": 55.0, "dietary_fiber_g": 25.0,
}


def _pct_after(c: str, pos: int) -> Optional[int]:
    """값 바로 뒤의 "기준치 대비 %" 를 읽는다. 사이에 끼어든 잡음 글자(공백, |, 영문 1~3자)는 건너뛴다."""
    m = re.match(r"[|\sA-Za-z]{0,3}(\d{1,3})(?:\.\d+)?%", c[pos: pos + 12])
    return int(m.group(1)) if m else None


def _dv_error(key: Optional[str], value: float, pct: int) -> Optional[float]:
    dv = DAILY_VALUE.get(key or "")
    if not dv:
        return None
    return abs(value / dv * 100.0 - pct)


def _split_nine(key: Optional[str], raw: str, upper: float) -> Optional[Tuple[float, int]]:
    """"…497%" 처럼 값·단위(g→9)·퍼센트가 한 덩어리로 붙은 숫자를 (값, 퍼센트)로 나눈다.

      "497"   → 4 g, 7 %        "3.296" → 3.2 g, 6 %       "7947" → 7 g, 47 %
      "10919" → 10 g, 19 %      "090"   → 0 g, 0 %         "303"  → 3 g, 3 % (g→0)
    기준치(DAILY_VALUE)와 가장 잘 맞는 분할을 고르고, 맞는 분할이 없으면 None.
    """
    best: Optional[Tuple[float, int, float]] = None
    for k in range(1, len(raw) - 1):
        if raw[k] not in _G_MISREAD or raw[k - 1] == ".":
            continue
        head, tail = raw[:k], raw[k + 1:]
        if not tail.isdigit() or len(tail) > 3:
            continue
        try:
            val, pct = float(head), int(tail)
        except ValueError:
            continue
        if val > upper or pct > 999:
            continue
        err = _dv_error(key, val, pct)
        if err is None:
            continue
        tol = max(1.6, 0.25 * pct)
        if err <= tol and (best is None or err < best[2]):
            best = (val, pct, err)
    return (best[0], best[1]) if best else None


def _pct_consistent(key: Optional[str], v: float, pct: int, allow_lost_digit: bool = False) -> bool:
    """값 v 가 라벨에 인쇄된 기준치 대비 pct(%) 와 맞는가.

    allow_lost_digit: 단위(g)가 함께 읽힌 확실한 값이면 pct 의 자릿수가 하나 빠진 경우("14%"→"1%")도 맞다고 본다.
    """
    err = _dv_error(key, v, pct)
    if err is None:
        return True
    if err <= max(1.6, 0.25 * pct):
        return True
    if allow_lost_digit:
        expected = str(int(round(v / DAILY_VALUE[key or ""] * 100.0)))  # type: ignore[index]
        return len(expected) > len(str(pct)) and expected.startswith(str(pct))
    return False


def _resolve_candidates(key: Optional[str], raw: str, has_unit: bool, pct: Optional[int], upper: float
                        ) -> Optional[float]:
    """숫자 문자열 하나를 OCR 오독(소수점 소실, g→9/8/0)까지 고려해 가장 그럴듯한 값으로 해석한다."""
    s = raw.replace(",", "")
    try:
        float(s)
    except ValueError:
        return None
    # 라벨은 소수 첫째 자리까지만 표기한다. 단위 없이 "0.29", "8.99" 처럼 둘째 자리가 9 면 g 를 9 로 읽은 것이다.
    if not has_unit and re.fullmatch(r"\d+\.\d9", s):
        s = s[:-1]
    # "09" — 앞자리 0 인 두 자리 정수는 표기에 없다. 0g 의 g 를 읽은 것이다(트랜스지방 "0g" 이 가장 흔하다).
    if not has_unit and re.fullmatch(r"0[980]", s):
        s = "0"
    base = float(s)

    # 우선순위 순 후보: ① 그대로 ② 끝의 g 오독 글자를 뗀 정수 ③ 뗀 뒤 소수점 삽입 ④ 소수점 삽입
    cands: List[float] = [base]
    if not has_unit and len(s) >= 2 and s[-1] in _G_MISREAD and "." not in s[-2:]:
        t = s[:-1]
        try:
            cands.append(float(t))  # "179"→17, "0.29"→0.2
            if "." not in t and len(t) >= 2:
                cands.append(float(t[:-1] + "." + t[-1]))  # "419"→4.1
        except ValueError:
            pass
    if "." not in s and len(s) >= 2:
        cands.append(float(s[:-1] + "." + s[-1]))  # 소수점이 빠진 "41"→4.1

    if pct is not None and DAILY_VALUE.get(key or ""):
        # 기준치 대비 %와 맞는 첫 후보. 정수 후보를 소수 후보보다 먼저 본다(라벨은 대개 정수 표기).
        for v in cands:
            if 0 <= v <= upper and _pct_consistent(key, v, pct, allow_lost_digit=has_unit and v == base):
                return v
        return base

    # %가 없을 때
    # (1) 값이 물리적으로 불가능하면(상한 초과) g 오독 글자를 뗀 후보를 사용
    if base > upper:
        for v in cands[1:]:
            if 0 <= v <= upper:
                return v
    return base


def _extract_value(c: str, name_re: str, unit_default: str, start: int, upper: float,
                   key: Optional[str] = None) -> Tuple[Optional[float], Optional[int], Optional[str]]:
    """공백 제거 텍스트 c 에서 영양소 한 항목의 값을 찾는다. (값, 위치, 한정어)

    한정어 "lt" 는 라벨에 "1g 미만" 처럼 인쇄된 경우다. 이때 값은 표기된 기준값(1)이다.
    """
    pat = re.compile(rf"(?:{name_re})[:：|]*(?:약)?(<|<=|≤)?{_NUM}\s*({_UNIT_MASS})?")
    for m in pat.finditer(c, start if start >= 0 else 0):
        sign, raw, unit = m.group(1), m.group(2), m.group(3)
        end = m.end()
        lt = bool(sign) or bool(_LT_AFTER.match(c, end))
        v: Optional[float]
        if unit is None and c[end: end + 1] == "%":
            # "단백질497%" — 값(4) + 단위 오독(g→9) + 퍼센트(7%) 가 붙은 경우만 값으로 인정한다.
            # 그렇지 않으면 "기준치 대비 비율"이지 값이 아니다.
            sp = _split_nine(key, raw, upper)
            if sp is None:
                continue
            v = sp[0]
        else:
            pct = _pct_after(c, end)
            if unit is None:
                v = None
                if lt and len(raw) >= 2 and raw.endswith("9"):
                    # "1g 미만" 의 g 를 9 로 읽은 "19미만" → 1
                    stripped = _to_float(raw[:-1])
                    if stripped in _LT_BOUNDS:
                        v = stripped
                if v is None:
                    v = _resolve_candidates(key, raw, False, pct, upper)
            else:
                v = _to_float(raw)
                if v is not None and key in DAILY_VALUE and unit in ("g", "mg"):
                    v = _resolve_candidates(key, raw, True, pct, upper)
                if v is not None:
                    if unit in ("kg", "㎏"):
                        v *= 1000
                    elif unit in ("mcg", "μg", "µg"):
                        v /= 1000
                    elif unit_default == "mg" and unit == "g":
                        v *= 1000
                    elif unit_default == "g" and unit == "mg":
                        v /= 1000
        if v is None or v < 0 or v > upper:
            continue
        return round(v, 3), m.start(), ("lt" if lt else None)

    # 표가 열 단위로 쪼개져 값이 이름 뒤쪽에 따로 나온 경우: 이름 뒤 "%" 를 건너뛰고 다음 값 사용
    pat2 = re.compile(rf"(?:{name_re})[:：|]*(?:{_NUM}%)?[^가-힣]{{0,6}}{_NUM}({_UNIT_MASS})")
    m = pat2.search(c, start if start >= 0 else 0)
    if m:
        v2 = _to_float(m.group(2))
        unit = m.group(3)
        if v2 is not None:
            if unit_default == "mg" and unit == "g":
                v2 *= 1000
            elif unit_default == "g" and unit == "mg":
                v2 /= 1000
            if 0 <= v2 <= upper:
                return round(v2, 3), m.start(), ("lt" if _LT_AFTER.match(c, m.end()) else None)
    return None, None, None


def _extract_energy(c: str, start: int) -> Optional[float]:
    """열량(kcal). '1회 제공량당', '100g당' 같은 기준당 값을 우선한다."""
    cands: List[Tuple[int, float, str]] = []
    for m in re.finditer(rf"{_NUM}\s*kcal", c, re.I):
        v = _to_float(m.group(1))
        if v is None or v <= 0 or v > 10000:
            continue
        ctx_after = c[m.end(): m.end() + 4]
        if ctx_after.startswith("기준") or ctx_after.startswith("이므로"):
            continue  # "2,000kcal 기준"
        ctx_before = c[max(0, m.start() - 6): m.start()]
        # "1일 영양성분 기준치에 대한 비율(%)은 2,000kcal 기준" 각주 — 줄이 바뀌어 "기준" 이 안 붙어도 건너뛴다.
        # OCR 이 천 단위 쉼표를 마침표로 읽어 "2.000kcal"(=2.0) 이 되는 경우도 포함한다.
        wide_before = c[max(0, m.start() - 14): m.start()]
        if re.fullmatch(r"2[.,]?0{2,3}", m.group(1)) or (
            v in (2000.0, 2.0) and re.search(r"비율|기준치|%은|영양성분", wide_before)
        ):
            continue
        cands.append((m.start(), v, ctx_before))
    if not cands:
        # "열량 175" 처럼 단위 없이 쓰인 경우
        m = re.search(rf"(?:열량|에너지|칼로리)[:：|]*{_NUM}(?!%)", c)
        if m:
            v = _to_float(m.group(1))
            if v and 0 < v <= 10000:
                return v
        return None

    def score(item: Tuple[int, float, str]) -> Tuple[int, int]:
        pos, _v, before = item
        s = 0
        if "당" in before[-3:]:  # "…(60g)당 107kcal", "100g당 255kcal"
            s += 3
        if "열량" in before or "에너지" in before:
            s += 2
        if "내용량" in before or "총" in before[-2:]:
            s -= 1  # "총 내용량 120g(214kcal)" 은 전체 열량
        if start >= 0 and pos >= start:
            s += 1
        return (s, -pos)

    best = max(cands, key=score)
    return best[1]


# ─────────────────────────────────────────────────────────────
# 2) 기준량 (영양성분 표시 기준)
# ─────────────────────────────────────────────────────────────
def _extract_reference(c: str, start: int) -> Dict:
    ref = {"amount": None, "unit": None, "text": None, "basis": "unknown"}
    region_start = max(0, start - 20) if start >= 0 else 0
    region = c[region_start: region_start + 260] if start >= 0 else c

    def mk(amount: float, unit: str, text: str, basis: str) -> Dict:
        unit = "ml" if unit.lower() in ("ml", "㎖", "m") else ("L" if unit == "L" else "g")
        if unit == "L":
            amount, unit = amount * 1000, "ml"
        return {"amount": amount, "unit": unit, "text": text, "basis": basis}

    # a) "N g/ml 당" — 기준량이 명시된 경우 (100g당 이 있으면 우선)
    per = []
    for m in re.finditer(r"(\d+(?:\.\d+)?)(g|ml|mL|L|m)\)?당", region):
        v = _to_float(m.group(1))
        if v and 0 < v <= 5000:
            per.append((v, m.group(2), m.group(0)))
    if per:
        pick = next((p for p in per if abs(p[0] - 100) < 1e-9), per[0])
        return mk(pick[0], pick[1], pick[2], "per_100" if pick[0] == 100 else "serving")

    # b) "1회 제공량 30g", "1회 분량(30g)"
    m = re.search(r"1회(?:제공량|분량|섭취량|섭취참고량)\(?(\d+(?:\.\d+)?)(g|ml|mL)", c[region_start:] if start >= 0 else c)
    if m:
        v = _to_float(m.group(1))
        if v and 0 < v <= 5000:
            return mk(v, m.group(2), m.group(0), "serving")

    # c) "총 내용량 70ml" → 전체 기준
    m = re.search(r"(?:총내용량|내용량)[:：]?(\d+(?:\.\d+)?)(g|ml|mL|L)", c[region_start:] if start >= 0 else c)
    if m:
        v = _to_float(m.group(1))
        if v and 0 < v <= 5000:
            return mk(v, m.group(2), m.group(0), "total")
    return ref


# ─────────────────────────────────────────────────────────────
# 3) 원재료명 / 알레르기 문구
# ─────────────────────────────────────────────────────────────
_ING_LABEL = re.compile(r"원\s*재\s*료\s*명?\s*(?:및\s*함량)?|원\s*료\s*명|Ingredients?", re.I)
# 원재료명이 끝나는 지점을 알리는 다음 항목 머리말
_ING_STOP = re.compile(
    r"영양\s*정보|영양\s*성분|알레르기|알러지|보관\s*방법|보관방법|주의\s*사항|품목\s*보고|업소명|"
    r"제조\s*원|제조\s*업소|제조\s*판매|판매원|소비\s*기한|유통\s*기한|제조\s*일|포장\s*재질|"
    r"반품|교환|고객|소비자|상담|식품\s*유형|식품의\s*유형|내용량|부정\s*불량|HACCP|"
    r"이\s*제품은|본\s*제품은|※|▶|■|●|▲|○|\*\s*이"
)
_ALLERGY_HINT = re.compile(
    r"함유|알레르기|알러지|혼입|같은\s*(?:제조\s*)?(?:시설|설비|라인)|동일\s*(?:제조\s*)?(?:시설|설비)|사용한\s*제품과"
)


# 원재료 문단 사이에 끼어든 영양성분표 이름("…가공유크림(유크림, 탄수화물 우유단백질…") — 합성어("당류가공품")는 건드리지 않는다
_STRAY_TABLE_WORD = re.compile(
    r"(?<![가-힣A-Za-z])(?:나트륨|탄수화물|당류|콜레스테롤|콜레스테를|트랜스지방|트렌스지방|포화지방|열량)(?![가-힣A-Za-z])"
)


# "2.3g 1%" 처럼 단위가 붙은 값 + 기준치 대비 % 가 이어진 영양성분표 조각
_STRAY_TABLE_VALUE = re.compile(r"(?<![가-힣\d.])\d[\d.,]*\s*(?:mg|㎎|g|kcal)\s*\d{1,3}\s*%")


def _tidy_ingredients(t: str) -> str:
    t = _STRAY_TABLE_VALUE.sub(" ", t)
    t = _STRAY_TABLE_WORD.sub(" ", t)
    t = re.sub(r"\s*\n\s*", " ", t)
    t = re.sub(r"\s*([,，、])\s*", ", ", t)
    t = re.sub(r"([(\[{])\s+", r"\1", t)
    t = re.sub(r"\s+([)\]}])", r"\1", t)
    # OCR 이 낱말마다 띄어 읽은 경우("변성 전분") — 쉼표 앞 공백이 흔하면 한글 사이 공백 제거
    spaced = len(re.findall(r"\s,", t)) >= 3
    if spaced:
        t = re.sub(r"(?<=[가-힣])\s+(?=[가-힣])", "", t)
    t = re.sub(r"[ \t]{2,}", " ", t).strip(" ,.;")
    return t


# 영양성분표 줄(이름 + 숫자 + 단위)인지 판단
_NUTRIENT_ROW = re.compile(r"(나트륨|탄수화물|당류|지방|콜레스테롤|단백질|식이섬유)[^가-힣]{0,3}\d")

# 표/영양성분 조각 — 표와 원재료명 문단이 좌우로 놓인 라벨에서 같은 높이의 조각이 한 줄로 묶이면
# "나트륨40mg 2% | 시럽,폴리덱스트로스,설탕…" 처럼 섞인다. 원재료명 해석 전에 표 조각을 걷어 낸다.
_CELL_NAME = (
    r"(?:나트륨|나트름|탄수화물|탄수회물|당류|(?<![가-힣])지방|트랜스\s*지방|트렌스\s*지방|포화\s*지방|"
    r"콜레스테[롤를]|콜레스[가-힣]{1,3}|단백질|식이섬유)"
)
_CELL_PREFIX = re.compile(
    rf"^\s*(?:"
    rf"\d{{1,3}}(?:\.\d+)?\s*%\s*"  # 앞 칸의 기준치 대비 %
    rf"|{_CELL_NAME}\s*[:：]?\s*(?:약\s*)?[<＜]?\s*\d[\d.,]*\s*(?:mg|㎎|g|kcal)?\s*(?:미\s*만)?\s*(?:\d{{1,3}}\s*%)?\s*"
    rf")+"
)
_CELL_ONLY = re.compile(
    r"^\s*(?:"
    r"[|\-–—·•]*"                                       # 구분선
    r"|\d{1,3}(?:\.\d+)?\s*%"                           # 기준치 대비 %
    r"|\d[\d.,]*\s*(?:mg|㎎|g|kcal|ml|mL)\s*(?:\d{1,3}\s*%)?"  # 값 + 단위 (+ %)
    r"|(?:총\s*)?내용량.*|1\s*일\s*영양\s*성분.*|영양\s*(?:정보|성분).*|기준치\s*에\s*대한.*|\d+\s*(?:g|ml|mL)\s*당.*"
    r")\s*$"
)


def _strip_table_cells(lines: List[str]) -> List[str]:
    """줄을 " | " 열 단위로 나눠 영양성분표 조각을 버리고 나머지(원재료명 문단)만 이어 붙인다."""
    out: List[str] = []
    for line in lines:
        keep: List[str] = []
        for seg in re.split(r"\s*\|\s*", line):
            seg = _CELL_PREFIX.sub("", seg).strip()
            if not seg or _CELL_ONLY.match(seg):
                continue
            keep.append(seg)
        if keep:
            out.append(" ".join(keep))
    return out
_NOISE_LINE = re.compile(r"https?://|www\.|@|\d{2,4}-\d{3,4}-\d{4}|고객|상담|소비자|반품|교환|유통기한|소비기한|보관")


def _hangul_ratio(s: str) -> float:
    letters = re.sub(r"[\s\d\W_]+", "", s)
    if not letters:
        return 0.0
    return sum(1 for ch in letters if "가" <= ch <= "힣") / len(letters)


def _looks_like_ingredients(line: str) -> bool:
    """원재료 나열처럼 보이는 줄: 쉼표가 있고 한글이 많으며 영양성분표/연락처 줄이 아님."""
    c = compact(line)
    if len(c) < 8:
        return False
    commas = line.count(",") + line.count("，") + line.count("、")
    if commas < 1:
        return False
    if _NUTRIENT_ROW.search(c) and "%" in c and commas < 4:
        return False
    # 연락처/고객센터 문구가 섞여도 쉼표가 많은 긴 문단(원재료 목록)은 원재료로 본다
    if _NOISE_LINE.search(line) and commas < 6:
        return False
    return _hangul_ratio(line) >= 0.45


def _heuristic_ingredients(lines: List[str]) -> Optional[str]:
    """원재료명 머리말을 못 찾았을 때: 쉼표가 많은 줄이 이어진 가장 긴 구간을 원재료로 본다."""
    best: List[str] = []
    cur: List[str] = []
    gap = 0
    for line in lines:
        if _looks_like_ingredients(line):
            cur.append(line)
            gap = 0
        elif cur and gap < 1 and len(compact(line)) <= 24:
            # 한 줄 정도의 끊김(표 조각/잡음)은 허용
            gap += 1
            cur.append(line)
        else:
            if cur and sum(len(compact(x)) for x in cur) > sum(len(compact(x)) for x in best):
                best = cur
            cur, gap = [], 0
    if cur and sum(len(compact(x)) for x in cur) > sum(len(compact(x)) for x in best):
        best = cur
    # 뒤쪽 잡음 줄 제거
    while best and not _looks_like_ingredients(best[-1]):
        best = best[:-1]
    total = sum(len(compact(x)) for x in best)
    if total < 24:
        return None
    return " ".join(best)


def _extract_ingredients(lines: List[str]) -> Tuple[Optional[str], Optional[int]]:
    """원재료명 구간 텍스트 (본문, 시작 줄 인덱스). 머리말이 없으면 내용 기반으로 추정한다."""
    start_idx = None
    first_text = ""
    for i, line in enumerate(lines):
        m = _ING_LABEL.search(line)
        if not m:
            continue
        start_idx = i
        first_text = line[m.end():].lstrip(" :：|-")
        break

    if start_idx is not None:
        parts = [first_text] if first_text else []
        for line in lines[start_idx + 1: start_idx + 40]:
            stripped = line.lstrip(" |•·-")
            if _ING_STOP.match(stripped):
                break
            # 다른 머리말이 줄 중간에서 시작하면 그 앞까지만
            m = _ING_STOP.search(line)
            if m and m.start() > 0 and re.search(r"[가-힣A-Za-z)\]]", line[: m.start()]):
                parts.append(line[: m.start()])
                break
            # 쉼표가 없는 줄은 앞 줄이 쉼표/여는 괄호로 끝났거나 괄호가 열려 있을 때만 원재료의 이어짐으로 본다.
            # (원재료 목록이 끝난 뒤의 "돼지바", "샤베트 70ml(175 kcal)" 같은 제품명/문구를 끊는다)
            joined = " ".join(p for p in parts if p)
            if parts and not re.search(r"[,，、]", line):
                opened = sum(joined.count(c) for c in "([{") - sum(joined.count(c) for c in ")]}")
                continues = (
                    opened > 0
                    or joined.rstrip().endswith((",", "，", "、", "(", "[", "{", "·", "/", ":"))
                    or line.lstrip().startswith(("(", ")", "[", "]", "{", "}", ":", "·"))
                    or len(compact(line)) <= 4  # 줄 바꿈으로 잘린 한두 글자
                )
                if not continues and len(compact(joined)) >= 12:
                    break
            parts.append(line)
        body = _tidy_ingredients(" ".join(p for p in parts if p).strip())
        if len(compact(body)) >= 15:
            return body, start_idx
    else:
        body = ""

    # 머리말이 없거나 본문이 거의 비어 있으면(표 구조 때문에 끊김) 내용 기반 휴리스틱을 시도한다
    guess = _heuristic_ingredients(lines)
    if guess and len(compact(guess)) > len(compact(body)):
        return _tidy_ingredients(guess), start_idx
    if body:
        return body, start_idx
    return None, None


def _split_allergy_tail(ingredients: Optional[str]) -> Tuple[Optional[str], str]:
    """원재료 본문 끝에 붙은 "우유, 대두 함유" 문구를 분리한다."""
    if not ingredients:
        return ingredients, ""
    m = re.search(
        r"((?:알레르기\s*(?:유발)?\s*(?:물질|성분|표시)?\s*[:：]?\s*)?"
        r"(?:[가-힣A-Za-z()·]+\s*[,，·/]\s*)*[가-힣A-Za-z()·]+\s*(?:를|을)?\s*함유(?:하고\s*있습니다|한\s*제품)?[.\s]*)$",
        ingredients,
    )
    if m and len(m.group(1)) <= 80:
        return ingredients[: m.start()].strip(" ,.;"), m.group(1).strip()
    return ingredients, ""


# 알레르기 항목 이름(식약처 표시 대상 + 흔한 표기). 목록처럼 보이는 줄을 찾는 데 쓴다.
_ALLERGEN_WORDS = {
    "우유", "계란", "달걀", "달갈", "난류", "알류", "메밀", "땅콩", "대두", "밀", "고등어", "게", "새우",
    "돼지고기", "복숭아", "토마토", "아황산류", "이산화황", "호두", "닭고기", "쇠고기", "소고기", "오징어",
    "조개류", "굴", "전복", "홍합", "바지락", "잣", "견과류", "갑각류", "생선", "아몬드", "참깨", "돼지", "쇠", "닭",
}


def _allergen_list_ratio(line: str) -> Tuple[float, int]:
    """줄이 '알레르기 항목 이름들의 나열'처럼 보이는 정도. (비율, 토큰 수)"""
    toks = [t for t in re.split(r"[\s,，、·ㆍ•/\-]+", line) if t]
    cleaned = []
    for t in toks:
        t = re.sub(r"[()\[\]]", "", t)
        t = re.sub(r"(함유|을|를|등)$", "", t)
        if t:
            cleaned.append(t)
    if not cleaned:
        return 0.0, 0
    hit = sum(1 for t in cleaned if t in _ALLERGEN_WORDS)
    return hit / len(cleaned), len(cleaned)


def _extract_allergy_text(lines: List[str], ingredients_span: Optional[Tuple[int, int]] = None) -> str:
    """알레르기/함유/혼입 문구가 있는 줄을 모은다.

    OCR 은 문장을 줄 단위로 끊기 때문에 "목록 줄 + 혼입 가능 줄"처럼 서로 떨어진 줄이 생긴다.
    힌트 줄 앞뒤 3줄 안에서 '알레르기 항목 나열처럼 보이는 줄'도 함께 포함한다.
    """
    hint_idx = [i for i, l in enumerate(lines) if _ALLERGY_HINT.search(l)]
    keep = set(hint_idx)
    for i in hint_idx:
        for j in range(max(0, i - 3), min(len(lines), i + 4)):
            if j in keep:
                continue
            ratio, n = _allergen_list_ratio(lines[j])
            if n >= 2 and ratio >= 0.5:
                keep.add(j)
            elif abs(j - i) == 1 and n >= 1 and ratio >= 1.0:
                keep.add(j)
    return "\n".join(lines[j] for j in sorted(keep))


# ─────────────────────────────────────────────────────────────
# 4) 제품 정보
# ─────────────────────────────────────────────────────────────
_MFR = re.compile(
    r"(?:제조\s*판매\s*원|제조\s*·?\s*판매\s*원|제조\s*원|제조\s*업소\s*명?|업소\s*명\s*및\s*소재지|제조\s*사|제조\s*자|판매\s*원)"
    r"\s*[:：]?\s*([^\n/|,;]{2,30})"
)
_REPORT_NO = re.compile(r"품목\s*보고\s*번호\s*[:：]?\s*([0-9][0-9\-\s]{9,24})")
_PRODUCT_LABEL = re.compile(r"제\s*품\s*명\s*[:：]?\s*([^\n|]{2,40})")
_CORP = re.compile(r"\(주\)|㈜|주식회사|\(유\)|유한회사|농업회사법인|영농조합법인")
_PLANT = re.compile(r"\s*(?:[가-힣]{1,4})?\s*(?:제?\d*)\s*(?:공장|사업장|제조소|사업소)$")


def _clean_manufacturer(raw: str) -> Optional[str]:
    s = _CORP.sub(" ", raw)
    s = re.sub(r"[\(\)\[\]]", " ", s)
    s = _PLANT.sub("", s.strip())
    s = re.sub(r"\s+", " ", s).strip(" ,.:·-")
    # 주소처럼 보이면 제외
    if re.search(r"(시|군|구|도)\s*[가-힣]+(로|길|동|읍|면)", s) or len(s) < 2:
        return None
    return s[:30]


def _extract_product(lines: List[str], full: str) -> Dict:
    info: Dict = {"name": None, "manufacturer": None, "report_no": None}
    m = _REPORT_NO.search(full)
    if m:
        digits = re.sub(r"\D", "", m.group(1))
        if 10 <= len(digits) <= 16:
            info["report_no"] = digits
    m = _MFR.search(full)
    if m:
        info["manufacturer"] = _clean_manufacturer(m.group(1))
    m = _PRODUCT_LABEL.search(full)
    if m:
        name = re.sub(r"\s+", " ", m.group(1)).strip(" :|-")
        # "제품명 탄 단지 닭 가슴살..." 처럼 다음 항목이 이어지면 잘라 준다
        name = re.split(r"식품\s*유형|식품의\s*유형|내용량|원재료", name)[0].strip()
        if 2 <= len(name) <= 40:
            info["name"] = name
    return info


# ─────────────────────────────────────────────────────────────
# 5) 검증 경고
# ─────────────────────────────────────────────────────────────
def _validate(n: Dict[str, Optional[float]]) -> List[Dict]:
    w: List[Dict] = []

    def add(code: str, msg: str, fields: List[str]) -> None:
        w.append({"code": code, "message": msg, "fields": fields})

    carb, sugar, fat = n.get("carbohydrate_g"), n.get("sugar_g"), n.get("fat_g")
    sat, trans = n.get("saturated_fat_g"), n.get("trans_fat_g")
    protein, kcal = n.get("protein_g"), n.get("energy_kcal")

    if carb is not None and sugar is not None and sugar > carb + 0.01:
        add("SUGAR_GT_CARB", "당류가 탄수화물보다 큽니다. 숫자를 확인해주세요.", ["sugar_g", "carbohydrate_g"])
    if fat is not None and sat is not None and sat > fat + 0.01:
        add("SAT_GT_FAT", "포화지방이 지방보다 큽니다. 숫자를 확인해주세요.", ["saturated_fat_g", "fat_g"])
    if fat is not None and trans is not None and trans > fat + 0.01:
        add("TRANS_GT_FAT", "트랜스지방이 지방보다 큽니다. 숫자를 확인해주세요.", ["trans_fat_g", "fat_g"])
    if None not in (kcal, carb, protein, fat) and kcal and kcal > 0:
        est = carb * 4 + protein * 4 + fat * 9
        # 표시값은 반올림/식이섬유/알코올 때문에 차이가 나므로 넉넉한 허용 범위를 둔다
        if abs(est - kcal) > max(40.0, kcal * 0.35):
            add("ENERGY_MISMATCH", "열량이 탄수화물·단백질·지방 값과 맞지 않습니다. 숫자를 확인해주세요.", ["energy_kcal"])
    sodium = n.get("sodium_mg")
    if sodium is not None and sodium > 8000:
        add("SODIUM_RANGE", "나트륨 값이 비정상적으로 큽니다. 단위(mg)를 확인해주세요.", ["sodium_mg"])
    return w


# ─────────────────────────────────────────────────────────────
# 공개 API
# ─────────────────────────────────────────────────────────────
def parse_label(text: str, *, flow_text: Optional[str] = None, avg_ocr_score: float = 1.0) -> Dict:
    """OCR 텍스트(여러 장을 이어 붙인 것도 가능)를 구조화한다.

    text      : 같은 높이의 조각을 한 줄로 묶은 "표 해석용" 텍스트 (영양성분/기준량/제품정보)
    flow_text : 읽기 순서 텍스트 (원재료명 문단 해석용). 없으면 text 를 사용한다.
    """
    lines = _clean_lines(text)
    flow_lines = _clean_lines(flow_text) if flow_text else lines
    full = "\n".join(lines)
    c = fix_units(compact(full))

    start = _nutrition_start(c)
    nutrition: Dict[str, Optional[float]] = {k: None for k in NUTRIENT_KEYS}
    qualifiers: Dict[str, str] = {}  # {"sugar_g": "lt"} — 라벨에 "1g 미만" 으로 인쇄된 항목
    for key, name_re, unit, upper in _NAMES:
        # 표 시작 이후 구간을 먼저, 없으면 전체에서 찾는다
        v, _, q = _extract_value(c, name_re, unit, start, upper, key)
        if v is None and start >= 0:
            v, _, q = _extract_value(c, name_re, unit, -1, upper, key)
        nutrition[key] = v
        if v is not None and q:
            qualifiers[key] = q
    nutrition["energy_kcal"] = _extract_energy(c, start)

    # 지방 값이 트랜스/포화 지방 값을 잘못 집어 온 경우 방어
    # (이름 정규식이 "지방" 단독이라 "트랜스지방0g" 의 "지방0g" 에 걸릴 수 있음)
    nutrition, fat_q = _fix_fat_collision(c, nutrition, start)
    qualifiers.pop("fat_g", None)
    if fat_q and nutrition.get("fat_g") is not None:
        qualifiers["fat_g"] = fat_q

    reference = _extract_reference(c, start)

    ingredients, ing_idx = _extract_ingredients(_strip_table_cells(flow_lines))
    ingredients, tail = _split_allergy_tail(ingredients)
    # OCR 이 한 글자씩 틀리게 읽은 원재료명("데스트린", "아세설팔칼륨")을 사전으로 바로잡는다
    ingredient_fixes: List[Dict[str, str]] = []
    if ingredients:
        ingredients, ingredient_fixes = _correct_ingredients(ingredients)
    allergy_text = _extract_allergy_text(flow_lines)
    if tail and tail not in allergy_text:
        allergy_text = (allergy_text + "\n" + tail).strip()

    product = _extract_product(lines, full)

    filled = [k for k in ("energy_kcal", "sodium_mg", "carbohydrate_g", "sugar_g", "fat_g", "protein_g") if nutrition[k] is not None]
    warnings: List[Dict] = []
    if len(filled) == 0:
        warnings.append({"code": "NO_NUTRITION", "message": "영양성분표를 읽지 못했습니다. 표 전체가 보이도록 가까이서 다시 촬영하거나 직접 입력해주세요.", "fields": []})
    elif len(filled) < 4:
        warnings.append({"code": "PARTIAL_NUTRITION", "message": "일부 영양성분만 읽었습니다. 비어 있는 항목을 확인해주세요.", "fields": []})
    if not ingredients:
        warnings.append({"code": "NO_INGREDIENTS", "message": "원재료명을 읽지 못했습니다. 원재료명이 있는 면도 함께 촬영하면 알레르기 성분을 확인할 수 있어요.", "fields": []})
    if reference["amount"] is None and filled:
        warnings.append({"code": "NO_REFERENCE_AMOUNT", "message": "영양성분 기준량(예: 100g당, 1회 제공량)을 읽지 못해 100g 기준으로 가정합니다. 기준량을 확인해주세요.", "fields": []})
    if avg_ocr_score and avg_ocr_score < 0.8:
        warnings.append({"code": "LOW_CONFIDENCE", "message": "사진이 흐리거나 글자가 작아 인식이 불확실합니다. 인식 결과를 꼭 확인해주세요.", "fields": []})
    warnings.extend(_validate(nutrition))

    # 신뢰도: 핵심 항목 채움 비율 + OCR 점수
    conf = 0.0
    conf += 0.6 * (len(filled) / 6.0)
    conf += 0.2 * (1.0 if ingredients else 0.0)
    conf += 0.2 * min(1.0, max(0.0, avg_ocr_score))
    conf = round(min(1.0, conf), 2)

    if len(filled) == 0 and not ingredients:
        status = "empty"
    elif len(filled) >= 5 and not any(x["code"] in ("ENERGY_MISMATCH", "SUGAR_GT_CARB") for x in warnings):
        status = "ok"
    else:
        status = "partial"

    return {
        "status": status,
        "product": product,
        "reference": reference,
        "nutrition": nutrition,
        "qualifiers": qualifiers,
        "ingredients": ingredients,
        "ingredient_corrections": ingredient_fixes,
        "allergy_text": allergy_text or None,
        "warnings": warnings,
        "confidence": conf,
        "raw_text": full,
    }


def _fix_fat_collision(c: str, n: Dict[str, Optional[float]], start: int
                       ) -> Tuple[Dict[str, Optional[float]], Optional[str]]:
    """'지방' 정규식이 '트랜스지방'/'포화지방' 뒤쪽에서 값을 가져오지 않도록 다시 계산한다. (영양성분, 한정어)"""
    pat = re.compile(rf"(?<![트포불유돼돈동])(?<!트랜스)(?<!포화)(?<!불포화)지방[:：|]*(?:약)?{_NUM}\s*({_UNIT_MASS})?")
    best = None
    qual: Optional[str] = None
    for m in pat.finditer(c, start if start >= 0 else 0):
        unit = m.group(2)
        if unit is None and c[m.end(): m.end() + 1] == "%":
            continue
        if _to_float(m.group(1)) is None:
            continue
        v = _resolve_candidates("fat_g", m.group(1), unit is not None, _pct_after(c, m.end()), 1000)
        if v is None or v > 1000:
            continue
        best = round(v / 1000 if unit == "mg" else v, 3)
        qual = "lt" if _LT_AFTER.match(c, m.end()) else None
        break
    n = dict(n)
    n["fat_g"] = best
    return n, qual
