"""건강검진 파서 / 바코드 서비스 단위 테스트"""
import json
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import checkup_parser as C  # noqa: E402

CHECKUP = """건강검진 결과통보서
성명 홍길동 주민등록번호 720315-1234567
신장 172.5 cm 체중 78.2 kg 허리둘레 90
혈압 (최고/최저) 152/96 mmHg
공복혈당 131 mg/dL
총콜레스테롤 245 mg/dL
HDL-콜레스테롤 38 mg/dL
중성지방 210 mg/dL
LDL-콜레스테롤 168 mg/dL
혈청크레아티닌 1.1 신사구체여과율(e-GFR) 55 mL/min/1.73m2
"""


class CheckupParserTest(unittest.TestCase):
    def setUp(self):
        self.r = C.parse_checkup(CHECKUP, today=date(2026, 10, 13))
        self.p = self.r["profile"]

    def test_values(self):
        self.assertEqual(self.p["height_cm"], 172.5)
        self.assertEqual(self.p["weight_kg"], 78.2)
        self.assertEqual(self.p["systolic"], 152)
        self.assertEqual(self.p["diastolic"], 96)
        self.assertEqual(self.p["fasting_glucose"], 131)
        self.assertEqual(self.p["total_cholesterol"], 245)
        self.assertEqual(self.p["hdl_value"], 38)
        self.assertEqual(self.p["tg_value"], 210)
        self.assertEqual(self.p["ldl_value"], 168)
        self.assertEqual(self.p["gfr_value"], 55)

    def test_age_and_gender_from_resident_number_without_leaking_it(self):
        self.assertEqual(self.p["gender"], "male")
        self.assertEqual(self.p["age"], 54)  # 1972-03-15 → 2026-10-13 기준 54세
        self.assertNotIn("720315", json.dumps(self.r, ensure_ascii=False))

    def test_hypertension_stage(self):
        self.assertEqual(self.p["hypertension_stage"], 1)
        r2 = C.parse_checkup("혈압 165/102")
        self.assertEqual(r2["profile"]["hypertension_stage"], 2)
        r3 = C.parse_checkup("혈압 118/76")
        self.assertIsNone(r3["profile"]["hypertension_stage"])

    def test_diseases_are_suggestions_not_confirmed(self):
        self.assertEqual(self.r["diseases"], [])
        names = {s["name"] for s in self.r["suggested_diseases"]}
        self.assertEqual(names, {"고혈압", "이상지질혈증", "2형 당뇨", "신장병"})
        for s in self.r["suggested_diseases"]:
            self.assertTrue(s["reason"])

    def test_implausible_values_are_dropped(self):
        r = C.parse_checkup("신장 17 cm 체중 9 kg 혈압 300/20")
        self.assertIsNone(r["profile"]["height_cm"])
        self.assertIsNone(r["profile"]["weight_kg"])
        self.assertIsNone(r["profile"]["systolic"])

    def test_empty(self):
        r = C.parse_checkup("")
        self.assertEqual(r["status"], "empty")
        self.assertTrue(r["warnings"])


class BarcodeServiceTest(unittest.TestCase):
    """B 폴더 구조를 임시로 만들어 연결 로직을 검증한다 (zbar 없이도 동작)."""

    STUB_MODULE = '''
import json
from pathlib import Path

class ReportNoLookup:
    def __init__(self, p):
        self._m = json.load(open(p, encoding="utf-8"))
    def lookup(self, c):
        return self._m.get(c.strip())
    def __len__(self):
        return len(self._m)

def decode_barcode(path):
    return None
'''

    def setUp(self):
        import barcode_service as B

        self.B = B
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        (d / "barcode_module.py").write_text(self.STUB_MODULE, encoding="utf-8")
        (d / "mapping.json").write_text(json.dumps({"8801043014830": "200105495411", "012345678905": "R-UPC"}), encoding="utf-8")
        (d / "mapping_meta.json").write_text(
            json.dumps({"200105495411": ["신라면", "(주)농심", "유탕면"]}, ensure_ascii=False), encoding="utf-8"
        )
        self.svc = B.BarcodeService(module_dir=d)

    def tearDown(self):
        self.tmp.cleanup()

    def test_lookup_ok_with_meta(self):
        r = self.svc.lookup("8801043014830")
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["report_no"], "200105495411")
        self.assertEqual(r["product_name"], "신라면")
        self.assertEqual(r["manufacturer"], "(주)농심")

    def test_lookup_without_meta_still_returns_report_no(self):
        r = self.svc.lookup("012345678905")
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["report_no"], "R-UPC")
        self.assertIsNone(r["product_name"])

    def test_upc_a_and_ean13_variants(self):
        # 12자리 UPC-A 로 저장된 코드를 13자리(앞에 0)로 조회해도 찾는다
        self.assertEqual(self.svc.lookup("0012345678905")["status"], "ok")

    def test_not_found(self):
        self.assertEqual(self.svc.lookup("9999999999999")["status"], "not_found")

    def test_missing_module_dir(self):
        svc = self.B.BarcodeService(module_dir=Path(self.tmp.name) / "nope")
        svc._dir = Path(self.tmp.name) / "nope"
        # 존재하지 않는 폴더를 직접 지정하면 로딩 실패 → unavailable
        try:
            r = svc.lookup("8801043014830")
        except FileNotFoundError:
            r = {"status": "unavailable"}
        self.assertEqual(r["status"], "unavailable")

    def test_decode_image_roundtrip(self):
        try:
            import barcode  # python-barcode
            from barcode.writer import ImageWriter
            from pyzbar.pyzbar import decode  # noqa: F401
        except Exception:
            self.skipTest("python-barcode/pyzbar 미설치")
        import io

        buf = io.BytesIO()
        barcode.get("ean13", "880104301483", writer=ImageWriter()).write(buf)
        r = self.svc.decode_image(buf.getvalue())
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["code"], "8801043014830")
        self.assertEqual(r["product_name"], "신라면")

    def test_decode_image_with_rotation_and_noise(self):
        try:
            import barcode
            from barcode.writer import ImageWriter
            from pyzbar.pyzbar import decode  # noqa: F401
            from PIL import Image, ImageFilter
        except Exception:
            self.skipTest("python-barcode/pyzbar 미설치")
        import io

        buf = io.BytesIO()
        barcode.get("ean13", "880104301483", writer=ImageWriter()).write(buf)
        img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
        img = img.rotate(90, expand=True, fillcolor="white").filter(ImageFilter.GaussianBlur(1.2))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=60)
        r = self.svc.decode_image(out.getvalue())
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["code"], "8801043014830")


if __name__ == "__main__":
    unittest.main()
