"""라벨 파서 단위 테스트 (OCR 엔진 없이 텍스트만 사용)

실행:  cd ml && python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import label_parser as P  # noqa: E402

# 실제 라벨을 RapidOCR 로 읽은 결과(줄 단위) — 돼지바(롯데웰푸드)
PIGBAR = """제조판매원롯데웰푸드(주)천안공장/충남천안시서북구2공단 4로19
품목보고번호200504480017
원재료명
정제수,비스켓 분태[밀가루(밀;미국산,호주산),설탕,쇼트닝(잠유(말레이시아산)),기타과당,코코아분말]엘로빙초코[설탕,정제야자유(야
코등)),혼합분유딸기쟁,버터,혼합식용유기타과당식물성유지혼합제제1 (구아검,로커스트콩검,타마린드검,카라기난),유화제,향료,혼합제제(구아
검로커스트콩검,카라기난)혼합제제(주정정제수향료,에틸말,정산,프로필렌글리콜)구연산혼합제제V(자주색고구마색소혼합제제(아라비아
검데스트린,글리세린지방산에스테르,3-카로틴,비타민E),향료제제(프로필렌글리콜,정제수번트슈가,바닐린바닐라추출물,글리세린),안나토색소
돼지바
샤베트 70ml(175 kcal)
·달갈, 호두,토마토,복숭아,돼지고기,아황산류
총 내용량70ml
혼입 가능·영하18°C 이하에서 냉동 보관
175 kcal
나트륨75 mg 4%탄수화물21 g 6 % 당류17 g 17 %
지방9g 17 %트랜스지방0g 포화지방 4g27 %
콜레스테롤5mg 2%단백질2g 4%
1일 영양성분 기준치에 대한 비율(%)은 2,000 kcal 기준이므로개인의 필요열량에 따라
"""

# 구글 OCR 스타일(낱말 사이 공백이 많은) — 소시지, 1개(60g)당 표시
SAUSAGE = """제품명 탄 단지 닭 가슴살 소시지 훈제 맛 식품 유형 소시지 ( 비 살균 제품 )
내용량 120g ( 214kcal ) 보관 방법 -18 ℃ 이하 에서 냉동 보관
품목 보고 번호 19980262020509
닭 가슴살 ( 국내산 ) 80.21 % , 정제수 , 대두유 [ 대두유 ( 외국산 ) ] , 기타 가공품 ( 벨기에 산 ) , 포도당 , 백설탕 ,
원재료 | 정제 소금 , 복합 조미 식품 , L- 글루탐산 나트륨 ( 향미 증진제 ) , 혼합 제제 ( 폴리 인산 나트륨 ) , 콜라겐 케이싱
명
닭고기 , 대두 , 쇠고기 , 우유 , 이산화황 함유
업소명 및 소재지 ( 주 ) 태림 에프 웰 / 경기도 파주시 파평면 청송 로 208 번길 100
영양 정보 | 총 내용량 120g ( 60gx2 개 )
1 개 ( 60g ) 당 107kcal
나트륨 280mg 14 % 탄수화물 2g 1 % 당류 1g 1 %
지방 7g 13 % 트랜스 지방 0g 포화 지방 1.6g 11 %
콜레스테롤 35mg 12 % 단백질 9g 16 %
1 일 영양 성분 기준치 에 대한 비율 ( % ) 은 2,000kcal 기준 이므로 개인 의 필요 에 따라 다를수 있습니다 .
"""

BACON = """영양 정보 | 총 내용량 340g / 100g 당 255 kcal
나트륨 790 mg 40 % 탄수화물 1g0 % 당류 1g1 %
지방 21 g 39 % 트랜스 지방 0g 포화 지방 6g 40 %
콜레스테롤 60 mg 20 % 단백질 15g 27 %
1 일 영양 성분 기준치 에 대한 비율 ( % ) 은 2,000 kcal 기준"""


class LabelParserTest(unittest.TestCase):
    def test_pigbar_rapidocr_text(self):
        r = P.parse_label(PIGBAR, avg_ocr_score=0.9)
        n = r["nutrition"]
        self.assertEqual(n["energy_kcal"], 175)
        self.assertEqual(n["sodium_mg"], 75)
        self.assertEqual(n["carbohydrate_g"], 21)
        self.assertEqual(n["sugar_g"], 17)
        self.assertEqual(n["fat_g"], 9)
        self.assertEqual(n["trans_fat_g"], 0)
        self.assertEqual(n["saturated_fat_g"], 4)
        self.assertEqual(n["cholesterol_mg"], 5)
        self.assertEqual(n["protein_g"], 2)
        # 기준량: 총 내용량 70ml
        self.assertEqual(r["reference"]["amount"], 70)
        self.assertEqual(r["reference"]["unit"], "ml")
        # 품목보고번호/원재료
        self.assertEqual(r["product"]["report_no"], "200504480017")
        self.assertTrue(r["ingredients"].startswith("정제수"))
        self.assertIn("밀가루", r["ingredients"])
        self.assertIn("안나토색소", r["ingredients"])
        self.assertNotIn("영양", r["ingredients"])
        # 혼입 가능 문구가 allergy_text 에 포함
        self.assertIn("혼입", r["allergy_text"])
        self.assertIn("달갈", r["allergy_text"])

    def test_serving_basis_and_spaced_text(self):
        r = P.parse_label(SAUSAGE)
        n = r["nutrition"]
        self.assertEqual(n["energy_kcal"], 107)  # 총 내용량 120g(214kcal) 이 아니라 1개(60g)당 값
        self.assertEqual(n["sodium_mg"], 280)
        self.assertEqual(n["carbohydrate_g"], 2)
        self.assertEqual(n["sugar_g"], 1)
        self.assertEqual(n["fat_g"], 7)
        self.assertEqual(n["trans_fat_g"], 0)
        self.assertEqual(n["saturated_fat_g"], 1.6)
        self.assertEqual(n["cholesterol_mg"], 35)
        self.assertEqual(n["protein_g"], 9)
        self.assertEqual(r["reference"]["amount"], 60)
        self.assertEqual(r["reference"]["basis"], "serving")
        self.assertEqual(r["product"]["name"], "탄 단지 닭 가슴살 소시지 훈제 맛")
        self.assertEqual(r["product"]["report_no"], "19980262020509")
        self.assertIn("닭고기", r["allergy_text"])
        self.assertIn("함유", r["allergy_text"])
        # 원재료 본문에는 알레르기 "함유" 문장이 들어가지 않는다
        self.assertNotIn("함유", r["ingredients"])
        self.assertIn("콜라겐케이싱", r["ingredients"].replace(" ", ""))

    def test_per_100g_is_preferred(self):
        r = P.parse_label(BACON)
        self.assertEqual(r["reference"]["amount"], 100)
        self.assertEqual(r["reference"]["basis"], "per_100")
        self.assertEqual(r["nutrition"]["energy_kcal"], 255)
        self.assertEqual(r["nutrition"]["sodium_mg"], 790)
        self.assertEqual(r["nutrition"]["fat_g"], 21)
        self.assertEqual(r["nutrition"]["protein_g"], 15)

    def test_percent_column_is_not_a_value(self):
        # 값이 비어 이름 뒤에 곧바로 "%" 만 있는 경우 값으로 읽지 않는다
        r = P.parse_label("영양정보 나트륨 4% 탄수화물 21g 6%")
        self.assertIsNone(r["nutrition"]["sodium_mg"])
        self.assertEqual(r["nutrition"]["carbohydrate_g"], 21)

    def test_g_misread_as_9_is_repaired_with_daily_value_percent(self):
        # OCR 이 "17g" → "179", "4.1g" → "419", "19g" → "199" 로 읽은 경우: %를 근거로 바로잡는다
        text = "영양정보 100mL당 75kcal\n나트륨 45mg 2%\n당류 179 | 17%\n지방 419 | 8%\n탄수화물 199 | 6%\n포화지방 2.3g 15%"
        r = P.parse_label(text)
        self.assertEqual(r["nutrition"]["sugar_g"], 17)
        self.assertEqual(r["nutrition"]["fat_g"], 4.1)
        self.assertEqual(r["nutrition"]["carbohydrate_g"], 19)
        self.assertEqual(r["nutrition"]["saturated_fat_g"], 2.3)
        self.assertEqual(r["nutrition"]["sodium_mg"], 45)
        self.assertEqual(r["reference"]["amount"], 100)

    def test_unit_misreads(self):
        r = P.parse_label("영양정보 총내용량660 m, 100m당125 kall\n나트륨 35 m9 2 %탄수화물 13g 4%")
        self.assertEqual(r["reference"]["amount"], 100)
        self.assertEqual(r["reference"]["unit"], "ml")
        self.assertEqual(r["nutrition"]["energy_kcal"], 125)
        self.assertEqual(r["nutrition"]["sodium_mg"], 35)

    def test_sodium_in_grams_is_converted(self):
        r = P.parse_label("영양성분 나트륨 0.5g 25%")
        self.assertEqual(r["nutrition"]["sodium_mg"], 500)

    def test_empty_text_gives_empty_status_and_guidance(self):
        r = P.parse_label("")
        self.assertEqual(r["status"], "empty")
        codes = [w["code"] for w in r["warnings"]]
        self.assertIn("NO_NUTRITION", codes)

    def test_validation_warnings(self):
        r = P.parse_label("영양정보 100g당 100kcal 나트륨 100mg 탄수화물 5g 당류 9g 지방 2g 포화지방 3g 단백질 1g")
        codes = [w["code"] for w in r["warnings"]]
        self.assertIn("SUGAR_GT_CARB", codes)
        self.assertIn("SAT_GT_FAT", codes)

    def test_ingredient_heading_variants(self):
        r = P.parse_label("원재료명 및 함량 : 쌀(국산), 정제소금\n영양성분 나트륨 100mg")
        self.assertEqual(r["ingredients"], "쌀(국산), 정제소금")

    def test_parentheses_nutrition_names_not_confused_with_ingredients(self):
        # 원재료의 "돼지지방", "유지방" 이 지방 영양소로 읽히지 않는다
        text = "원재료명 돼지지방(국산) 12%, 유지방, 정제수\n영양정보 100g당 200kcal\n지방 15g 28% 단백질 8g 15%"
        r = P.parse_label(text)
        self.assertEqual(r["nutrition"]["fat_g"], 15)
        self.assertEqual(r["nutrition"]["protein_g"], 8)


HEAD = "영양정보 총 내용량 100g 열량 200kcal\n"


def _row(line: str):
    """영양성분 표 한 줄만 바꿔 가며 파싱한다."""
    return P.parse_label(HEAD + "나트륨 100mg 5%\n탄수화물 30g 9%\n" + line + "\n지방 5g 9%\n단백질 3g 5%")


class LessThanMarkerTest(unittest.TestCase):
    def test_less_than_value_is_kept_and_flagged(self):
        r = _row("당류 1g 미만 1%")
        self.assertEqual(r["nutrition"]["sugar_g"], 1)
        self.assertEqual(r["qualifiers"], {"sugar_g": "lt"})

    def test_ocr_variants_of_less_than(self):
        for line in ("당류 1g이만", "당류 1g 마만", "당류 | 1g | 미만", "당류 <1g", "당류 lg미만", "당류 19 미만"):
            with self.subTest(line=line):
                r = _row(line)
                self.assertEqual(r["nutrition"]["sugar_g"], 1)
                self.assertEqual(r["qualifiers"].get("sugar_g"), "lt")

    def test_plain_value_has_no_qualifier(self):
        r = _row("당류 3g 3%")
        self.assertEqual(r["nutrition"]["sugar_g"], 3)
        self.assertEqual(r["qualifiers"], {})

    def test_trans_fat_and_sodium_less_than(self):
        r = P.parse_label(HEAD + "나트륨 5mg 미만\n트랜스지방 0.5g 미만\n포화지방 2g 13%\n지방 5g 9%")
        self.assertEqual(r["nutrition"]["sodium_mg"], 5)
        self.assertEqual(r["nutrition"]["trans_fat_g"], 0.5)
        self.assertEqual(r["qualifiers"], {"sodium_mg": "lt", "trans_fat_g": "lt"})


class UnitMisreadTest(unittest.TestCase):
    def test_g_read_as_8_or_0_is_repaired_with_percent(self):
        r = P.parse_label("영양정보 100g당 100kcal\n당류 38 | 3%\n탄수화물 189 | 6%")
        self.assertEqual(r["nutrition"]["sugar_g"], 3)
        self.assertEqual(r["nutrition"]["carbohydrate_g"], 18)  # 18.9 가 아니라 정수 18 (라벨은 정수 표기)
        r = P.parse_label("영양정보 100g당 100kcal\n당류303%지방9g17%")
        self.assertEqual(r["nutrition"]["sugar_g"], 3)

    def test_two_decimal_value_ending_in_9_is_g(self):
        r = P.parse_label("영양정보 100g당 100kcal\n지방0.29|0%\n단백질8.99|16%")
        self.assertEqual(r["nutrition"]["fat_g"], 0.2)
        self.assertEqual(r["nutrition"]["protein_g"], 8.9)

    def test_zero_read_as_korean_or_latin_letter(self):
        r = P.parse_label("영양정보 100g당 100kcal\n트랜스지방09\n포화지방 이g\n단백질Cg|0%")
        self.assertEqual(r["nutrition"]["trans_fat_g"], 0)
        self.assertEqual(r["nutrition"]["saturated_fat_g"], 0)
        self.assertEqual(r["nutrition"]["protein_g"], 0)

    def test_percent_with_lost_digit_does_not_override_explicit_unit(self):
        # "14g 14%" 의 % 가 "1%" 로 읽혀도 단위가 붙은 14g 을 1.4 로 바꾸지 않는다
        r = P.parse_label("영양정보 100g당 100kcal\n당류14g1%\n단백질2g")
        self.assertEqual(r["nutrition"]["sugar_g"], 14)


class EnergyFootnoteTest(unittest.TestCase):
    def test_daily_value_footnote_is_not_energy(self):
        text = (
            "영양정보 총내용량 48g 138kcal\n"
            "나트륨 50mg 3%\n탄수화물 30g 9%\n"
            "비닐류 1일 영양성분 기준치에 대한 비율(%)은 2.000kcal\nOTHER 기준이므로 개인의 필요 열량에 따라 다를 수 있습니다."
        )
        self.assertEqual(P.parse_label(text)["nutrition"]["energy_kcal"], 138)


class TableCellStrippingTest(unittest.TestCase):
    def test_nutrition_cells_beside_ingredient_paragraph_are_removed(self):
        text = (
            "영양정보 총내용량474mL\n"
            "100mL당75kcal | 원재료명 정제수,유크림(외국산:호주,이탈리아),치커리뿌리\n"
            "나트륨40mg 2% | 추출물,혼합분유(탈지분유,유청),알룰로오스\n"
            "탄수화물13g | 4% 시럽,폴리덱스트로스,설탕,정제소금\n"
            "당류5g | 5% | 구아검,셀룰로스검,카라기난\n"
        )
        r = P.parse_label(text)
        ing = r["ingredients"].replace(" ", "")
        self.assertIn("혼합분유(탈지분유,유청)", ing)
        self.assertIn("폴리덱스트로스", ing)
        self.assertIn("카라기난", ing)
        self.assertNotIn("나트륨", ing)
        self.assertNotIn("탄수화물", ing)


if __name__ == "__main__":
    unittest.main()
