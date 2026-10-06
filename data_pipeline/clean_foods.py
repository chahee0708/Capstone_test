"""
clean_foods.py — 식품 영양성분 원본 데이터 정제 스크립트

[역할]
    data_pipeline/raw/ 에 있는 식품 원본 파일(.xlsx 또는 UTF-8 BOM .csv)을 읽어
    영양소를 100g/100ml 기준으로 환산하고, 컬럼 이름을 Neo4j Food 노드 속성 이름으로
    맞추고, 원재료/알레르기 목록을 "|" 구분 문자열로 정리해 clean/ 에 저장한다.
    원재료는 다구성 제품 표기("면: …", "면/…", "/ 액상스프: …", "•", "*", ". "),
    "/원산지", 유산균 수, 끝 마침표, 번호 접미사("설탕II", "합성향료 3종")를 정리한 뒤 저장한다.

[입력]
    명령행 인자 1개: 원본 파일 경로 (25개 컬럼, 형식은 README/요구사항 참고)
    예) python clean_foods.py raw/emart_foods.csv.xlsx

[출력] (data_pipeline/clean/)
    - foods_clean.csv : 정제된 식품 데이터 (UTF-8 with BOM). 컬럼 = Neo4j Food 노드 속성 이름
        report_no        품목제조보고번호 (문자열, 앞자리 0 보존)  ← product_report_no
        name             식품명                                   ← food_name
        company          제조사                                   ← manufacturer
        category_major   식품 대분류                              ← food_category_major
        category_mid     식품 중분류                              ← food_category_mid
        serving_unit     환산 기준 단위 "g" 또는 "ml" (영양소 값은 100g 또는 100ml 당)
        calories         열량 kcal          ← energy_kcal
        carbohydrate     탄수화물 g         ← carbohydrate_g
        sugar            당류 g             ← sugar_g
        fat              지방 g             ← fat_g
        saturated_fat    포화지방 g         ← saturated_fat_g
        trans_fat        트랜스지방 g       ← trans_fat_g
        cholesterol      콜레스테롤 mg      ← cholesterol_mg (원본 빈 값은 빈 값 유지)
        protein          단백질 g           ← protein_g
        sodium           나트륨 mg          ← sodium_mg
        fiber            식이섬유 g         ← dietary_fiber_g  (기존 Food 노드에 없던 새 속성)
        potassium        칼륨 mg            ← potassium_mg     (새 속성)
        phosphorus       인 mg              ← phosphorus_mg    (새 속성)
        ingredient_list  원재료 목록, "|" 구분
        allergen_list    알레르기 유발 성분 목록, "|" 구분
        data_creation_date  데이터 생성일 YYYY-MM-DD
        기존 파일이 있으면 합친 뒤 report_no 별로 최신 data_creation_date 행만 남긴다.
        → 같은 형식의 새 파일을 여러 번 돌려도 누적·갱신된다.
    - errors.csv      : 이번 실행에서 처리하지 못한 행 + 실패 이유 (UTF-8 with BOM, 매 실행 덮어씀)
    - 콘솔            : 전체/성공/에러 행 수, serving_size로 기준량을 대체한 행 목록

[호출]
    데이터 담당자가 새 원본 파일을 받을 때마다 수동으로 실행한다.
    이후 Neo4j 적재 단계는 foods_clean.csv 를 입력으로 사용한다.
"""

import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import pandas as pd

# ------------------------------------------------------------------
# 상수 정의
# ------------------------------------------------------------------

# 스크립트 위치 기준 출력 폴더 (어느 경로에서 실행하든 data_pipeline/clean/ 에 저장)
CLEAN_DIR = Path(__file__).resolve().parent / "clean"

# 원본 파일이 반드시 가져야 하는 25개 컬럼
REQUIRED_COLUMNS = [
    "product_report_no", "food_name", "manufacturer", "food_category_major",
    "food_category_mid", "food_category_minor", "food_weight", "serving_size",
    "nutrient_reference_amount", "energy_kcal", "sodium_mg", "carbohydrate_g", "sugar_g",
    "fat_g", "trans_fat_g", "saturated_fat_g", "cholesterol_mg", "protein_g",
    "dietary_fiber_g", "potassium_mg", "phosphorus_mg", "ingredients",
    "allergy_ingredients", "data_creation_date", "source_code",
]

# [변경] 원본 영양소 컬럼 → Neo4j Food 노드 속성 이름 매핑 (12개)
# 순서는 기존 Food 속성 순서를 따르고, 기존에 없던 새 속성(fiber, potassium, phosphorus)은 뒤에 둔다
NUTRIENT_MAP = {
    "energy_kcal": "calories",
    "carbohydrate_g": "carbohydrate",   # [변경] carbs → carbohydrate
    "sugar_g": "sugar",
    "fat_g": "fat",                     # [변경] fats → fat
    "saturated_fat_g": "saturated_fat",
    "trans_fat_g": "trans_fat",
    "cholesterol_mg": "cholesterol",
    "protein_g": "protein",
    "sodium_mg": "sodium",
    "dietary_fiber_g": "fiber",         # 새 속성
    "potassium_mg": "potassium",        # 새 속성
    "phosphorus_mg": "phosphorus",      # 새 속성
}

# [변경] 출력 컬럼 순서 (Neo4j Food 노드 속성 이름)
OUTPUT_COLUMNS = (
    ["report_no", "name", "company", "category_major", "category_mid", "serving_unit"]
    + list(NUTRIENT_MAP.values())
    + ["ingredient_list", "allergen_list", "data_creation_date"]
)

# [추가] 이전 버전 foods_clean.csv 의 컬럼 이름 → 새 이름 (기존 결과와 병합할 때 사용)
LEGACY_OUTPUT_RENAME = {
    "product_report_no": "report_no",
    "food_name": "name",
    "manufacturer": "company",
    "unit": "serving_unit",
    "carbs": "carbohydrate",
    "fats": "fat",
}

# "숫자 + 단위(g / ml)" 패턴. 단위 뒤에 다른 글자(예: "당")가 붙어도 허용
AMOUNT_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(g|ml)(?![a-z])", re.IGNORECASE)

# 여는/닫는 괄호 종류 (중첩 깊이 계산용, 전각 괄호 포함)
OPEN_BRACKETS = "([{（［｛"
CLOSE_BRACKETS = ")]}）］｝"

# [추가] 다구성 제품 처리용 패턴
# 최상위에서 쉼표와 동일하게 취급하는 구분자 (예: "… 비타민B2. • 스프류: …", "… 녹차풍미유 * 스프류: …")
TOP_LEVEL_SEPARATORS = ",•*"
# "/" 뒤(공백 무시)에 "구성품명:" 이 올 때만 "/" 를 구분자로 본다. 구성품명은 콜론으로 끝나는 10자 이하 이름
# 예) "구연산 / 액상스프: 정제수" → 구분자 / "이눌린/치커리추출물" → 이름의 일부로 유지
SLASH_COMPONENT_LOOKAHEAD = re.compile(r"\s*[^\s,/:•*(){}\[\]][^,/:•*(){}\[\]]{0,9}:")
# 항목 안의 "구성품명:" 표기. 구성품명은 공백 없는 10자 이하 단어
#   (1) 앞부분 (선택)  (2) 구성품명  (3) 실제 원재료
# 예) "면: 소맥분" → ("", "면", "소맥분")
#     "녹차풍미유 스프류:쇠고기육수분말" → ("녹차풍미유", "스프류", "쇠고기육수분말")  ※ 원본에 구분자가 빠진 경우
COMPONENT_PREFIX = re.compile(r"^(?:(.*\S)\s+)?([^\s:]{1,10})\s*:\s*(.*)$")

# [추가] 번호 접미사 패턴: 항목 끝의 "N종", 아라비아 숫자, 로마숫자(I~V, 유니코드 Ⅰ~Ⅴ 포함)
# 바로 앞 글자가 영문/숫자면 제거하지 않음 → "비타민B2", "비타민B12" 유지
NUMBER_SUFFIX = re.compile(r"(?<![A-Za-z0-9])\s*(?:\d+\s*종|\d+|IV|V|I{1,3}|[ⅠⅡⅢⅣⅤ])$")

# [추가] "구성품명/" 으로 표기되는 구성품 이름 목록 (새 구성품명은 여기에 추가)
COMPONENT_NAMES = [
    "면", "건면", "유탕면", "스프", "스프류", "분말스프", "액상스프", "후레이크",
    "건더기", "건더기스프", "소스", "양념", "별첨",
]
# [추가] 항목 안의 "구성품명/" 또는 "구성품명 /" 표기
#   (1) 앞부분 (선택)  (2) 구성품명  (3) 실제 원재료
#   구성품명은 항목 맨 앞이거나 공백/마침표/하이픈 바로 뒤에 있어야 한다 → "분말스프" 안의 "스프" 오인 방지
# 예) "면/소맥분" → ("", "면", "소맥분"), "녹차풍미액 스프/설탕" → ("녹차풍미액 ", "스프", "설탕")
COMPONENT_SLASH = re.compile(
    r"^(.*?)(?:(?<=[\s.\-])|^)("
    + "|".join(sorted(map(re.escape, COMPONENT_NAMES), key=len, reverse=True))
    + r")\s*/\s*(.*)$"
)

# [추가] 원산지로 인정할 국가명 목록. "/국가명산" 만 원산지로 보고 지운다
# 국가명을 명시하는 방식이라 "구연산", "젖산", "아스코르빈산" 같은 산류 원재료는 절대 지워지지 않는다
ORIGIN_COUNTRIES = [
    "미국", "중국", "일본", "대만", "베트남", "태국", "필리핀", "인도네시아", "말레이시아", "싱가포르",
    "미얀마", "캄보디아", "인도", "파키스탄", "스리랑카", "호주", "뉴질랜드", "캐나다", "멕시코",
    "브라질", "칠레", "아르헨티나", "페루", "에콰도르", "콜롬비아", "영국", "아일랜드", "프랑스",
    "독일", "이탈리아", "스페인", "포르투갈", "네덜란드", "벨기에", "덴마크", "스웨덴", "노르웨이",
    "핀란드", "폴란드", "오스트리아", "스위스", "헝가리", "체코", "그리스", "터키", "튀르키예",
    "러시아", "우크라이나", "이스라엘", "이집트", "남아공", "남아프리카공화국", "케냐", "에티오피아",
]
# [추가] "/" 뒤가 원산지(국산, 국내산, 외국산, 수입산, 국가명+산)면 "/" 부터 끝까지 삭제
# 예) "쇼트닝/인도네시아산" → "쇼트닝"
ORIGIN_SUFFIX = re.compile(
    r"\s*/\s*(?:국산|국내산|외국산|수입산|(?:"
    + "|".join(sorted(map(re.escape, ORIGIN_COUNTRIES), key=len, reverse=True))
    + r")산).*$"
)

# [추가] 유산균 수 표기: "CFU" 가 있거나, "N억/N만 + 마리/이상" 형태
# 예) "유산균 1억 CFU/mL 이상", "복합유산균 16억마리이상/mL", "유기농유산균 400억 이상 / 400g"
#     ※ "100억유산균배양분말" 같은 원재료명은 해당 없음
BACTERIA_COUNT = re.compile(r"CFU|\d+\s*(?:억|만)\s*(?:마리|이상)", re.IGNORECASE)

# [추가] 항목 끝에서 지울 문장부호: 마침표(.), 그리고 구성품명 앞 조각에 남는 하이픈
# 예) "고추맛후레이크." → "고추맛후레이크", "비타민B2.-스프류/육개장조미료" 의 앞 조각 "비타민B2.-" → "비타민B2"
TRAILING_PUNCT = re.compile(r"[\s.\-]+$")


# ------------------------------------------------------------------
# 1. 파일 읽기
# ------------------------------------------------------------------

def read_raw(path: Path) -> pd.DataFrame:
    """원본 파일을 모든 컬럼 문자열(dtype=str)로 읽는다. → product_report_no 앞자리 0 보존"""
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        df = pd.read_excel(path, dtype=str)
    elif suffix == ".csv":
        # UTF-8 with BOM 파일: utf-8-sig 로 읽어야 첫 컬럼명에 BOM 문자가 붙지 않는다
        df = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
    else:
        raise ValueError(f"지원하지 않는 파일 형식입니다: {suffix} (.xlsx 또는 .csv만 가능)")

    # 컬럼명 앞뒤 공백 제거 후 필수 컬럼 존재 여부 확인
    df.columns = [str(c).strip() for c in df.columns]
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"필수 컬럼이 없습니다: {missing}")

    # 모든 셀의 앞뒤 공백 제거, 빈 문자열은 결측(NaN)으로 통일
    df = df[REQUIRED_COLUMNS].apply(lambda s: s.str.strip())
    return df.replace("", pd.NA)


# ------------------------------------------------------------------
# 2. 기준량 파싱
# ------------------------------------------------------------------

def parse_amount(text):
    """문자열에서 첫 번째 "숫자+g/ml" 를 찾아 (숫자, 단위소문자) 반환. 없으면 None"""
    if pd.isna(text):
        return None
    m = AMOUNT_PATTERN.search(str(text).replace(",", ""))
    if not m:
        return None
    value = Decimal(m.group(1))
    if value <= 0:
        return None  # 0 으로는 나눌 수 없으므로 실패 처리
    return value, m.group(2).lower()


def resolve_reference(row):
    """
    기준량과 단위를 결정한다.
    반환: (기준량, 단위, serving_size 사용 여부) / 실패 시 None
    """
    ref = row["nutrient_reference_amount"]

    # (1) nutrient_reference_amount 가 "숫자+단위" 형식이면 그대로 사용 (예: "100g", "190mL")
    if pd.notna(ref) and re.fullmatch(r"\d+(?:\.\d+)?\s*(g|ml)", str(ref).replace(",", ""), re.IGNORECASE):
        value, unit = parse_amount(ref)
        return value, unit, False

    # (2) 숫자가 없는 기준량(1매, 1봉, 1봉지, 1조각, 1일 섭취량 등)
    #     → serving_size 에서 괄호 안 또는 단독 "숫자+g/ml" 를 찾는다 (예: "1매 (24g)당" → 24g)
    parsed = parse_amount(row["serving_size"])
    if parsed:
        value, unit = parsed
        return value, unit, True

    # (3) 둘 다 실패
    return None


# ------------------------------------------------------------------
# 3. 100 기준 환산
# ------------------------------------------------------------------

def to_per_100(raw_value, reference: Decimal):
    """
    값 × 100 ÷ 기준량, 소수 둘째 자리 반올림(사사오입).
    원본이 빈 값이면 빈 값 그대로 반환 (0으로 바꾸지 않음).
    숫자로 해석할 수 없으면 ValueError.
    """
    if pd.isna(raw_value):
        return None
    value = Decimal(str(raw_value).replace(",", ""))  # 숫자가 아니면 여기서 예외 발생
    result = (value * 100 / reference).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(result)


# ------------------------------------------------------------------
# 4. 원재료 분리
# ------------------------------------------------------------------

def split_top_level(text: str):
    """
    괄호 (), [], {} 바깥(깊이 0)에 있는 구분자에서만 문자열을 나눈다. 중첩 괄호 고려
    [변경] 구분자: 쉼표 + "•", "*" + (뒤에 "구성품명:" 이 오는) "/" + "마침표+공백"
    """
    parts, buf, depth = [], [], 0
    for i, ch in enumerate(text):
        if ch in OPEN_BRACKETS:
            depth += 1
        elif ch in CLOSE_BRACKETS:
            depth = max(depth - 1, 0)  # 짝이 안 맞는 닫는 괄호가 있어도 음수로 내려가지 않게
        is_separator = depth == 0 and (
            ch in TOP_LEVEL_SEPARATORS
            # [추가] "/" 는 바로 뒤가 "구성품명:" 형태일 때만 구분자
            or (ch == "/" and SLASH_COMPONENT_LOOKAHEAD.match(text, i + 1))
            # [추가] "마침표+공백" 은 구분자. 예) "혼합제제. 스프류/고추장"
            #        숫자 사이 마침표("1.5")는 뒤에 공백이 없으므로 해당 없음
            or (ch == "." and text[i + 1:i + 2].isspace())
        )
        if is_separator:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    return parts


def remove_brackets(text: str) -> str:
    """괄호와 그 안의 내용(중첩 포함)을 모두 제거한다. 예) "밀가루(밀:미국산)" → "밀가루" """
    out, depth = [], 0
    for ch in text:
        if ch in OPEN_BRACKETS:
            depth += 1
        elif ch in CLOSE_BRACKETS:
            depth = max(depth - 1, 0)
        elif depth == 0:
            out.append(ch)
    return "".join(out)


def strip_component_prefix(name: str):
    """
    [추가] 항목 앞의 "구성품명:" 제거. 예) "면: 소맥분" → ["소맥분"]
    구성품명 앞에 다른 글자가 있으면(원본에서 구분자가 빠진 경우) 별도 원재료로 분리해 보존한다.
    예) "녹차풍미유 스프류:쇠고기육수분말" → ["녹차풍미유", "쇠고기육수분말"]
    괄호 안의 콜론("밀:미국산")은 이 단계 전에 괄호째 제거되므로 영향 없음.
    """
    m = COMPONENT_PREFIX.match(name)
    if not m:
        return [name]
    before, _component, rest = m.groups()
    return [s for s in (before, rest) if s]


def strip_number_suffix(name: str) -> str:
    """
    [추가] 항목 끝의 번호 접미사 제거.
    예) "설탕II"→"설탕", "식물성유지 1"→"식물성유지", "합성향료 3종"→"합성향료", "카라멜색소IV"→"카라멜색소"
    접미사 바로 앞이 영문이면 유지: "비타민B2" 그대로
    """
    return NUMBER_SUFFIX.sub("", name).strip()


def strip_component_slash(name: str):
    """
    [추가] 항목 안의 "구성품명/" 제거. 예) "면/소맥분", "면 / 소맥분" → ["소맥분"]
    구성품명 앞에 다른 글자가 있으면 별도 원재료로 분리. 예) "녹차풍미액 스프/설탕" → ["녹차풍미액", "설탕"]
    """
    m = COMPONENT_SLASH.match(name)
    if not m:
        return [name]
    before, _component, rest = m.groups()
    before = TRAILING_PUNCT.sub("", before)
    return [s for s in (before, rest.strip()) if s]


def strip_origin(name: str, removed_log=None) -> str:
    """
    [추가] "/" 뒤의 원산지 표기를 "/" 부터 끝까지 삭제. 예) "쇼트닝/인도네시아산" → "쇼트닝"
    removed_log(list)가 주어지면 삭제된 문자열을 기록 (검증·콘솔 보고용)
    """
    m = ORIGIN_SUFFIX.search(name)
    if not m:
        return name
    if removed_log is not None:
        removed_log.append(m.group(0).strip())
    return name[:m.start()].strip()


def strip_bacteria_count(name: str) -> str:
    """
    [추가] 유산균 수 표기가 있으면 첫 숫자부터 끝까지 삭제.
    예) "유산균 1억 CFU/mL 이상" → "유산균", "800억 CFU/1.8L" → "" (빈 항목은 이후 제거)
    """
    if not BACTERIA_COUNT.search(name):
        return name
    return re.sub(r"\d.*$", "", name).strip()


def build_ingredient_list(text, removed_origins=None):
    """
    원재료 문자열 → "|" 로 이어진 원재료 목록 (빈 값 제거, 중복 제거, 원래 순서 유지)
    [변경] removed_origins(list)를 주면 삭제된 원산지 표기("/○○산")를 기록한다
    """
    if pd.isna(text):
        return None
    seen = []
    for part in split_top_level(str(text)):
        # 괄호 및 내용 제거 → 연속 공백 1칸으로 → 앞뒤 공백 제거
        name = re.sub(r"\s+", " ", remove_brackets(part)).strip()
        # [추가] 유산균 수 제거 ("/mL", "/400g" 이 포함되므로 다른 "/" 처리보다 먼저)
        name = strip_bacteria_count(name)
        # [추가] "/원산지" 제거 (구성품명 처리보다 먼저 → "소스/중국산" 이 "중국산" 으로 남는 것 방지)
        name = strip_origin(name, removed_origins)
        # [추가] "구성품명:" 제거 (앞에 붙은 원재료가 있으면 분리)
        for piece in strip_component_prefix(name):
            # [추가] "구성품명/" 제거 (앞에 붙은 원재료가 있으면 분리)
            for sub in strip_component_slash(piece):
                # [추가] 끝의 마침표 제거 → 번호 접미사 정규화 ("비타민 B2." → "비타민 B2" 는 영문 뒤라 유지)
                sub = TRAILING_PUNCT.sub("", sub)
                sub = strip_number_suffix(sub)
                # 정규화 후 같은 이름은 첫 등장만 유지
                if sub and sub not in seen:
                    seen.append(sub)
    return "|".join(seen) if seen else None


# ------------------------------------------------------------------
# 5. 알레르기 목록
# ------------------------------------------------------------------

def build_allergen_list(text):
    """쉼표 분리 → 공백 제거 → "|" 로 연결. 빈 값이면 빈 값"""
    if pd.isna(text):
        return None
    items = [a.strip() for a in str(text).split(",") if a.strip()]
    return "|".join(items) if items else None


# ------------------------------------------------------------------
# 6. 행 단위 처리
# ------------------------------------------------------------------

def clean_rows(df: pd.DataFrame):
    """
    모든 행을 정제한다.
    반환: (성공 행 DataFrame, 에러 행 DataFrame, serving_size 대체 목록, 삭제된 원산지 목록)
    [변경] 삭제된 원산지 표기 목록을 함께 반환
    """
    clean_records, error_records, fallback_rows = [], [], []
    removed_origins = []  # [추가] (제품명, 삭제된 "/○○산" 문자열)

    for _, row in df.iterrows():
        # (0) 식별자 확인: product_report_no 가 없으면 중복 판정이 불가능하므로 에러
        if pd.isna(row["product_report_no"]):
            error_records.append({**row.to_dict(), "error_reason": "product_report_no 없음"})
            continue

        # (1) 기준량 결정
        ref = resolve_reference(row)
        if ref is None:
            error_records.append({
                **row.to_dict(),
                "error_reason": (
                    f"기준량 파싱 실패: nutrient_reference_amount='{row['nutrient_reference_amount']}', "
                    f"serving_size='{row['serving_size']}' 에서 숫자+g/ml 를 찾지 못함"
                ),
            })
            continue
        reference, unit, used_serving = ref

        # (2) 영양소 12개 100 기준 환산 + Neo4j 이름으로 매핑
        nutrients, bad_cols = {}, []
        for src_col, neo_name in NUTRIENT_MAP.items():
            try:
                nutrients[neo_name] = to_per_100(row[src_col], reference)
            except Exception:
                bad_cols.append(f"{src_col}='{row[src_col]}'")
        if bad_cols:
            error_records.append({**row.to_dict(), "error_reason": "숫자가 아닌 영양소 값: " + ", ".join(bad_cols)})
            continue

        # (3) serving_size 로 기준량을 대체한 행은 콘솔 보고용으로 기록
        if used_serving:
            fallback_rows.append((row["food_name"], row["nutrient_reference_amount"], f"{reference}{unit}"))

        # (4) 출력 레코드 구성
        origin_log = []  # [추가] 이 행에서 삭제된 원산지 표기
        clean_records.append({
            # [변경] 출력 컬럼 이름을 Neo4j Food 노드 속성 이름으로
            "report_no": row["product_report_no"],
            "name": row["food_name"],
            "company": row["manufacturer"],
            "category_major": row["food_category_major"],
            "category_mid": row["food_category_mid"],
            "serving_unit": unit,  # [변경] "100g 기준" → "g" / "ml"
            **nutrients,
            "ingredient_list": build_ingredient_list(row["ingredients"], origin_log),
            "allergen_list": build_allergen_list(row["allergy_ingredients"]),
            "data_creation_date": row["data_creation_date"],
        })
        removed_origins.extend((row["food_name"], o) for o in origin_log)

    clean_df = pd.DataFrame(clean_records, columns=OUTPUT_COLUMNS)
    error_df = pd.DataFrame(error_records, columns=REQUIRED_COLUMNS + ["error_reason"])
    return clean_df, error_df, fallback_rows, removed_origins


# ------------------------------------------------------------------
# 7. 기존 결과와 병합 + 중복 제거
# ------------------------------------------------------------------

def normalize_date(series: pd.Series) -> pd.Series:
    """data_creation_date 를 "YYYY-MM-DD" 문자열로 통일 (파싱 불가 값은 원본 유지)"""
    # [수정] 값마다 개별 파싱. 시리즈 전체를 한 번에 파싱하면 첫 값의 형식으로 추정해서
    # "2026-10-05"(기존 결과)와 "2026-10-05 00:00:00"(원본)이 섞일 때 한쪽이 NaT 가 되어
    # 최신 행 판정이 틀어진다
    parsed = series.map(lambda v: pd.to_datetime(v, errors="coerce"))
    parsed = pd.to_datetime(parsed, errors="coerce")
    return parsed.dt.strftime("%Y-%m-%d").where(parsed.notna(), series)


def merge_and_dedupe(new_df: pd.DataFrame, out_path: Path) -> pd.DataFrame:
    """
    기존 foods_clean.csv 가 있으면 새 결과와 합친 뒤,
    같은 report_no 중 data_creation_date 가 가장 최신인 행만 남긴다.
    날짜가 같으면 나중에 들어온 행(이번 실행분)을 남긴다.
    """
    frames = []
    if out_path.exists():
        # 기존 파일도 문자열로 읽어 report_no 앞자리 0 보존
        old_df = pd.read_csv(out_path, dtype=str, encoding="utf-8-sig")
        # [추가] 이전 버전 컬럼 이름으로 저장된 파일이면 새 이름으로 변환
        #        (변환하지 않으면 report_no 가 비어 기존 행이 잘못 병합된다)
        old_df = old_df.rename(columns=LEGACY_OUTPUT_RENAME)
        # [추가] 이전 버전 단위 값 "100g 기준" / "100ml 기준" → "g" / "ml"
        old_df["serving_unit"] = old_df["serving_unit"].str.replace(r"^100(g|ml) 기준$", r"\1", regex=True)
        for col in NUTRIENT_MAP.values():
            old_df[col] = pd.to_numeric(old_df[col], errors="coerce")
        frames.append(old_df.reindex(columns=OUTPUT_COLUMNS))
    frames.append(new_df)
    merged = pd.concat(frames, ignore_index=True)

    # 날짜 형식 통일 후 정렬 키 생성 (파싱 불가 날짜는 가장 오래된 것으로 취급)
    merged["data_creation_date"] = normalize_date(merged["data_creation_date"])
    merged["_order"] = range(len(merged))
    merged["_date"] = pd.to_datetime(merged["data_creation_date"], errors="coerce")

    # 날짜 오름차순 → 입력 순서 오름차순 정렬 후, 제품별 마지막 행만 유지
    merged = merged.sort_values(["_date", "_order"], na_position="first")
    merged = merged.drop_duplicates(subset="report_no", keep="last")
    return merged.sort_values("_order").drop(columns=["_order", "_date"]).reset_index(drop=True)


# ------------------------------------------------------------------
# 8. 메인
# ------------------------------------------------------------------

def main():
    # 인자 확인
    if len(sys.argv) != 2:
        print("사용법: python clean_foods.py <raw 파일 경로(.xlsx/.csv)>")
        sys.exit(1)
    in_path = Path(sys.argv[1])
    if not in_path.exists():
        print(f"파일을 찾을 수 없습니다: {in_path}")
        sys.exit(1)

    # 원본 읽기 → 행 단위 정제
    raw_df = read_raw(in_path)
    clean_df, error_df, fallback_rows, removed_origins = clean_rows(raw_df)

    # 이번 입력 파일 안의 중복도 함께 처리되도록 기존 결과와 병합 후 중복 제거
    CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CLEAN_DIR / "foods_clean.csv"
    err_path = CLEAN_DIR / "errors.csv"
    final_df = merge_and_dedupe(clean_df, out_path)

    # 저장 (UTF-8 with BOM → 엑셀에서 한글이 깨지지 않음)
    final_df.to_csv(out_path, index=False, encoding="utf-8-sig")
    error_df.to_csv(err_path, index=False, encoding="utf-8-sig")

    # 콘솔 요약 출력
    print(f"입력 파일          : {in_path}")
    print(f"전체 행 수         : {len(raw_df)}")
    print(f"성공 수            : {len(clean_df)}")
    print(f"에러 수            : {len(error_df)}")
    print(f"foods_clean.csv 행 : {len(final_df)} (기존 결과 병합·중복 제거 후)")
    print(f"\n[숫자 없는 기준량 → serving_size 로 환산한 행: {len(fallback_rows)}건]")
    for name, ref_text, used in fallback_rows:
        print(f"  - {name}  (기준량 '{ref_text}' → {used})")
    # [추가] 원산지 제거 내역 보고
    print(f"\n[원재료에서 삭제한 원산지 표기: {len(removed_origins)}건]")
    for name, origin in removed_origins:
        print(f"  - {name}: '{origin}'")
    if len(error_df):
        print("\n[에러 행]")
        for _, r in error_df.iterrows():
            print(f"  - {r['food_name']}: {r['error_reason']}")
    print(f"\n저장 완료: {out_path}\n          {err_path}")


if __name__ == "__main__":
    main()
