"""
checkup_parser.py
- 역할: 건강검진 결과지 OCR 텍스트 → 가입/프로필 입력에 쓸 수 있는 수치 항목
- 원칙
  * 읽은 수치만 채운다. 질환을 자동으로 확정하지 않는다.
    (수치/문구로부터 "해당될 수 있는 질환"을 suggested_diseases 로 제안만 한다 — 사용자가 직접 선택)
  * 주민등록번호는 나이/성별 계산에만 쓰고 결과·로그에 남기지 않는다.
  * 불확실하거나 비현실적인 값은 버린다.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Dict, List, Optional

from label_parser import compact, _nfkc  # noqa: F401  (공통 정규화 재사용)


def _f(m: Optional[re.Match], group: int = 1) -> Optional[float]:
    if not m:
        return None
    try:
        return float(m.group(group).replace(",", ""))
    except (ValueError, IndexError):
        return None


def _in_range(v: Optional[float], lo: float, hi: float) -> Optional[float]:
    return v if v is not None and lo <= v <= hi else None


def _first(c: str, patterns: List[str], lo: float, hi: float) -> Optional[float]:
    for p in patterns:
        for m in re.finditer(p, c, re.I):
            v = _in_range(_f(m), lo, hi)
            if v is not None:
                return v
    return None


def _age_gender_from_rrn(text: str, today: Optional[date] = None):
    """주민등록번호 앞 6자리 + 성별 자리로 나이/성별 계산. 번호 자체는 반환하지 않는다."""
    today = today or date.today()
    m = re.search(r"(?<!\d)(\d{2})(\d{2})(\d{2})\s*[-–]\s*([1-4])", text)
    if not m:
        return None, None
    yy, mm, dd, g = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return None, None
    year = (1900 if g in (1, 2) else 2000) + yy
    age = today.year - year - ((today.month, today.day) < (mm, dd))
    if not 0 <= age <= 120:
        age = None
    return age, ("male" if g in (1, 3) else "female")


def parse_checkup(text: str, *, avg_ocr_score: float = 1.0, today: Optional[date] = None) -> Dict:
    raw = _nfkc(text or "")
    c = compact(raw)

    profile: Dict[str, Optional[float]] = {
        "age": None, "gender": None, "height_cm": None, "weight_kg": None,
        "ldl_value": None, "tg_value": None, "hdl_value": None, "gfr_value": None,
        "systolic": None, "diastolic": None, "fasting_glucose": None, "total_cholesterol": None,
        "hypertension_stage": None,
    }

    # 나이/성별
    age, gender = _age_gender_from_rrn(raw, today)
    if age is None:
        age = _first(c, [r"(?:만)?(\d{1,3})세", r"나이[:：]?(\d{1,3})"], 1, 120)
        age = int(age) if age is not None else None
    profile["age"] = age
    if gender is None:
        m = re.search(r"성별[:：|]?(남|여)", c) or re.search(r"(남자|여자)", c)
        if m:
            gender = "male" if m.group(1).startswith("남") else "female"
    profile["gender"] = gender

    # 신체
    profile["height_cm"] = _first(c, [r"(?:신장|키)[^0-9]{0,6}(\d{2,3}(?:\.\d)?)"], 100, 230)
    profile["weight_kg"] = _first(c, [r"(?:체중|몸무게)[^0-9]{0,6}(\d{2,3}(?:\.\d)?)"], 25, 250)

    # 혈압 "혈압 135/85", "최고혈압 135 최저혈압 85"
    m = re.search(r"혈압[^0-9]{0,10}(\d{2,3})[/／](\d{2,3})", c)
    if m:
        profile["systolic"] = _in_range(float(m.group(1)), 70, 260)
        profile["diastolic"] = _in_range(float(m.group(2)), 40, 160)
    else:
        profile["systolic"] = _first(c, [r"(?:수축기|최고)혈압[^0-9]{0,6}(\d{2,3})", r"수축기[^0-9]{0,6}(\d{2,3})"], 70, 260)
        profile["diastolic"] = _first(c, [r"(?:이완기|최저)혈압[^0-9]{0,6}(\d{2,3})", r"이완기[^0-9]{0,6}(\d{2,3})"], 40, 160)

    # 혈액검사
    profile["fasting_glucose"] = _first(c, [r"공복혈당[^0-9]{0,8}(\d{2,3})", r"(?<![가-힣])혈당[^0-9]{0,8}(\d{2,3})"], 40, 600)
    profile["total_cholesterol"] = _first(c, [r"총콜레스테롤[^0-9]{0,8}(\d{2,3})", r"T[-.]?CHO[L]?[^0-9]{0,8}(\d{2,3})"], 80, 500)
    profile["hdl_value"] = _first(c, [r"HDL[-]?(?:콜레스테롤|C|CHO)?[^0-9]{0,10}(\d{2,3})", r"고밀도[^0-9]{0,12}(\d{2,3})"], 10, 150)
    profile["ldl_value"] = _first(c, [r"LDL[-]?(?:콜레스테롤|C|CHO)?[^0-9]{0,10}(\d{2,3})", r"저밀도[^0-9]{0,12}(\d{2,3})"], 20, 400)
    profile["tg_value"] = _first(c, [r"(?:중성지방|트리글리세라이드|트리글리세리드|TG)[^0-9]{0,8}(\d{2,4})"], 20, 3000)
    profile["gfr_value"] = _first(
        c, [r"(?:신사구체여과율|사구체여과율|e-?GFR|GFR)[^0-9]{0,14}(\d{1,3}(?:\.\d)?)"], 1, 200
    )

    # 고혈압 단계 (ProfilePage 안내와 동일 기준: 수축기 140~159 → 1, 160 이상 → 2)
    s, d = profile["systolic"], profile["diastolic"]
    if (s is not None and s >= 140) or (d is not None and d >= 90):
        profile["hypertension_stage"] = 2 if ((s or 0) >= 160 or (d or 0) >= 100) else 1

    # 질환 "제안" — 자동 확정하지 않는다
    suggestions: List[Dict] = []

    def suggest(name: str, reason: str) -> None:
        if not any(x["name"] == name for x in suggestions):
            suggestions.append({"name": name, "reason": reason})

    if profile["hypertension_stage"]:
        suggest("고혈압", f"혈압 {int(s or 0)}/{int(d or 0)} mmHg (140/90 이상)")
    ldl, tg, hdl, tc = profile["ldl_value"], profile["tg_value"], profile["hdl_value"], profile["total_cholesterol"]
    if ldl is not None and ldl >= 160:
        suggest("이상지질혈증", f"LDL 콜레스테롤 {ldl:g} mg/dL (160 이상)")
    if tg is not None and tg >= 200:
        suggest("이상지질혈증", f"중성지방 {tg:g} mg/dL (200 이상)")
    if hdl is not None and hdl < 40:
        suggest("이상지질혈증", f"HDL 콜레스테롤 {hdl:g} mg/dL (40 미만)")
    if tc is not None and tc >= 240:
        suggest("이상지질혈증", f"총콜레스테롤 {tc:g} mg/dL (240 이상)")
    glu = profile["fasting_glucose"]
    if glu is not None and glu >= 126:
        suggest("2형 당뇨", f"공복혈당 {glu:g} mg/dL (126 이상) — 당뇨 유형은 의사 확인이 필요합니다")
    gfr = profile["gfr_value"]
    if gfr is not None and gfr < 60:
        suggest("신장병", f"사구체여과율 {gfr:g} mL/min (60 미만)")

    # 문서에 질환명이 직접 적힌 경우도 제안으로만 표시
    mention_map = [
        ("고혈압", r"고혈압"), ("2형 당뇨", r"당뇨병?"), ("이상지질혈증", r"이상지질혈증|고지혈증"),
        ("신장병", r"만성(?:콩팥|신장)(?:병|질환)|신부전"),
    ]
    for name, pat in mention_map:
        if re.search(pat + r"(?:의심|\(의심\)|질환의심)", c):
            suggest(name, f"결과지에 '{name.split(' ')[-1]}' 의심 문구가 있습니다")

    numeric_fields = [k for k in profile if k != "hypertension_stage" and profile[k] is not None]
    warnings: List[Dict] = []
    if len(numeric_fields) == 0:
        warnings.append({"code": "NO_FIELDS", "message": "검진 결과 수치를 찾지 못했습니다. 결과지 전체가 선명하게 보이도록 다시 촬영하거나 직접 입력해주세요.", "fields": []})
    elif len(numeric_fields) < 3:
        warnings.append({"code": "FEW_FIELDS", "message": "일부 항목만 읽었습니다. 비어 있는 항목은 직접 입력해주세요.", "fields": []})
    if avg_ocr_score and avg_ocr_score < 0.8:
        warnings.append({"code": "LOW_CONFIDENCE", "message": "사진이 흐리거나 글자가 작아 인식이 불확실합니다. 읽은 값을 꼭 확인해주세요.", "fields": []})

    confidence = round(min(1.0, 0.7 * min(1.0, len(numeric_fields) / 6.0) + 0.3 * min(1.0, max(0.0, avg_ocr_score))), 2)
    status = "empty" if not numeric_fields else ("ok" if len(numeric_fields) >= 4 else "partial")

    return {
        "status": status,
        "profile": profile,
        "diseases": [],
        "suggested_diseases": suggestions,
        "allergens": [],
        "warnings": warnings,
        "confidence": confidence,
    }
