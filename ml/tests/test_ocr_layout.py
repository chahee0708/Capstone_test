"""OCR 후처리(줄 병합, 원재료명 단 추출, 사전 보정) 단위 테스트 — RapidOCR 모델 없이 좌표/텍스트만 사용

실행:  cd ml && python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import ingredient_corrector as C  # noqa: E402
import layout_blocks as L  # noqa: E402
import ocr_engine as E  # noqa: E402
import ocr_pipeline  # noqa: E402


def box(text, x0, y0, x1, y1, score=0.95):
    return E.OcrLine(text, score, float(x0), float(y0), float(x1), float(y1))


class MergeLineSetsTest(unittest.TestCase):
    def test_overlapping_garbled_line_is_replaced_by_better_read(self):
        # 기본 패스가 "단백질 7g" 을 "6∠"(0.62) 로 오독, 반전 패스가 제대로 읽은 경우
        base = [box("나트륨400mg", 10, 10, 200, 50), box("6∠", 10, 100, 140, 140, score=0.62)]
        inv = [box("단백질7g", 12, 101, 141, 141, score=0.97)]
        merged = E.merge_line_sets(base, inv)
        texts = sorted(l.text for l in merged)
        self.assertEqual(texts, ["나트륨400mg", "단백질7g"])

    def test_new_region_from_second_pass_is_added_only_when_confident(self):
        base = [box("영양정보", 0, 0, 100, 30)]
        inv = [box("정제수,설탕,혼합분유", 0, 100, 400, 140, score=0.9), box("잡음", 0, 300, 50, 330, score=0.5)]
        merged = E.merge_line_sets(base, inv)
        texts = [l.text for l in merged]
        self.assertIn("정제수,설탕,혼합분유", texts)
        self.assertNotIn("잡음", texts)

    def test_non_overlapping_primary_lines_are_kept(self):
        base = [box("가", 0, 0, 10, 10, score=0.5), box("나", 0, 50, 10, 60, score=0.9)]
        self.assertEqual(len(E.merge_line_sets(base, [])), 2)


class IngredientColumnTest(unittest.TestCase):
    def test_table_cell_paragraph_ignores_neighbouring_fields(self):
        # 왼쪽: 항목 머리말 셀, 오른쪽: 값. "원재료명" 셀은 문단 가운데 높이에 놓인다.
        lines = [
            box("제품명", 10, 20, 120, 60),
            box("테스트 아이스크림", 150, 20, 700, 60),
            box("원재료명", 10, 190, 130, 240),
            box("정제수,설탕,혼합분유(탈지분유,유청),", 150, 130, 900, 180),
            box("정제소금,유화제(대두레시틴),카라기난,", 150, 188, 900, 238),
            box("구아검,향료", 150, 246, 600, 296),
            box("제조원", 10, 320, 120, 360),
            box("(주)가나다식품 경기도 어딘가 123", 150, 320, 900, 360),
            box("나트륨 50mg 3 %", 10, 400, 400, 440),
            box("탄수화물 20g 6%", 10, 450, 400, 490),
        ]
        flow = L.ingredient_flow_lines(lines)
        self.assertIsNotNone(flow)
        compact = flow.replace(" ", "")
        self.assertIn("정제수,설탕", compact)
        self.assertIn("구아검,향료", compact)
        self.assertNotIn("테스트아이스크림", compact)
        self.assertNotIn("가나다식품", compact)
        self.assertNotIn("나트륨", compact)

    def test_inline_header_with_split_wide_line(self):
        # 검출기가 긴 줄을 왼쪽/오른쪽 두 박스로 나눈 경우: 오른쪽 조각을 같은 행으로 이어 붙인다
        lines = [
            box("원재료명:식용얼음,당통팥(중", 20, 50, 990, 100),
            box("국산:설탕,팥,정제수),팥시럽", 993, 52, 1600, 102),
            box("팥,기타과당,타피오카전분", 20, 105, 700, 155),
            box("1일 영양성분 기준치", 20, 300, 600, 340),
        ]
        flow = L.ingredient_flow_lines(lines)
        self.assertIsNotNone(flow)
        compact = flow.replace(" ", "")
        self.assertIn("식용얼음,당통팥(중국산:설탕", compact)
        self.assertIn("팥,기타과당", compact)
        self.assertNotIn("영양성분", compact)

    def test_no_header_returns_none(self):
        lines = [box("영양정보", 0, 0, 100, 30), box("나트륨 50mg", 0, 40, 100, 70)] * 3
        self.assertIsNone(L.ingredient_flow_lines(lines))


class IngredientCorrectorTest(unittest.TestCase):
    def test_one_syllable_misreads_are_fixed(self):
        fixed, changes = C.correct("정제수, 데스트린, 아세설팔칼륨(감미료), 향미중진제, 코코넷오일")
        self.assertIn("덱스트린", fixed)
        self.assertIn("아세설팜칼륨", fixed)
        self.assertIn("향미증진제", fixed)
        self.assertIn("코코넛오일", fixed)
        self.assertGreaterEqual(len(changes), 4)

    def test_valid_words_and_compounds_are_left_alone(self):
        text = "후추분말, 탄산칼륨, 마늘분말, 말차분말, 대파추출물분말"
        fixed, changes = C.correct(text)
        self.assertEqual(fixed, text)
        self.assertEqual(changes, [])

    def test_short_or_mixed_tokens_are_not_touched(self):
        text = "비타민C, L-글루탐산나트륨, D-소비톨, 유청"
        self.assertEqual(C.correct(text)[0], text)

    def test_plausibility_prefers_ingredient_text(self):
        good = "정제수, 설탕, 혼합분유(탈지분유, 유청), 정제소금"
        bad = "나트륨 100mg 5% 탄수화물 20g 고객상담실 080-123-4567 유통기한 제조일"
        self.assertGreater(C.plausibility(good), C.plausibility(bad))


class PipelineSelectionTest(unittest.TestCase):
    def test_parse_ocr_result_uses_column_when_layout_interleaves_fields(self):
        # 표(왼쪽)와 원재료명(오른쪽)이 같은 높이에 있어 layout 줄이 섞이는 라벨
        h = 40
        lines = [
            box("영양정보", 10, 10, 200, 10 + h),
            box("나트륨40mg", 10, 70, 300, 70 + h),
            box("2%", 310, 70, 380, 70 + h),
            box("원재료명", 420, 70, 560, 70 + h),
            box("정제수,유크림(외국산),치커리뿌리추출물,", 570, 70, 1500, 70 + h),
            box("탄수화물13g", 10, 125, 300, 125 + h),
            box("4%", 310, 125, 380, 125 + h),
            box("혼합분유(탈지분유,유청),알룰로오스시럽,", 570, 125, 1500, 125 + h),
            box("당류5g", 10, 180, 300, 180 + h),
            box("5%", 310, 180, 380, 180 + h),
            box("폴리덱스트로스,설탕,정제소금", 570, 180, 1500, 180 + h),
            box("1일 영양성분 기준치에 대한 비율(%)은 2,000kcal 기준", 10, 400, 900, 440),
        ]
        r = E.OcrResult(lines=lines, width=1600, height=500)
        parsed = ocr_pipeline.parse_ocr_result(r)
        ing = (parsed["ingredients"] or "").replace(" ", "")
        self.assertIn("정제수,유크림", ing)
        self.assertIn("혼합분유", ing)
        self.assertIn("폴리덱스트로스", ing)
        self.assertNotIn("나트륨", ing)
        self.assertNotIn("탄수화물", ing)
        self.assertEqual(parsed["nutrition"]["sodium_mg"], 40)


if __name__ == "__main__":
    unittest.main()
