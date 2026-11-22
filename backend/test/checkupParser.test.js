// 건강검진표 값 찾기 테스트. 실행: node --test test/checkupParser.test.js (backend 폴더에서)
// 고정값: 두 양식에 가짜 값을 채워 CLOVA General 로 읽은 글자 조각 (실존 인물 아님)
//   checkup_notice_fields.json : 일반건강검진 결과통보서 (공단 양식 이미지)
//   checkup_docx_fields.json   : 건강검진 결과통보서 Word 양식 → PDF
const test = require("node:test");
const assert = require("node:assert");
const { parseCheckup, estimateGfr } = require("../services/checkupParser");

const NOW = new Date("2026-11-22");
const notice = require("./ocr_samples/checkup_notice_fields.json");
const docx = require("./ocr_samples/checkup_docx_fields.json");

const pickValues = (r) => ({
  name: r.name, age: r.age, gender: r.gender, height: r.height, weight: r.weight,
  sbp: r.sbp, dbp: r.dbp, fastingGlucose: r.fastingGlucose, ldl: r.ldl, hdl: r.hdl, tg: r.tg,
});

test("결과통보서(공단 양식): 뒤섞인 표 순서와 빠진 '/' 에도 값을 읽는다", () => {
  const r = parseCheckup(notice, NOW);
  assert.deepStrictEqual(pickValues(r), {
    name: "김민준", age: 41, gender: "male", height: 170.2, weight: 68.5,
    sbp: 142, dbp: 92, fastingGlucose: 118, ldl: 160, hdl: 38, tg: 180,
  });
  assert.strictEqual(r.gfr, 75);
  assert.strictEqual(r.gfrEstimated, false);
  assert.deepStrictEqual(r.suggestedDiseases, ["고혈압", "이상지질혈증"]);
});

test("Word 양식: 식전혈당·트리글리세라이드, e-GFR 은 크레아티닌으로 계산", () => {
  const r = parseCheckup(docx, NOW);
  assert.deepStrictEqual(pickValues(r), {
    name: "김민준", age: 41, gender: "male", height: 170.2, weight: 68.5,
    sbp: 142, dbp: 92, fastingGlucose: 118, ldl: 160, hdl: 38, tg: 180,
  });
  assert.strictEqual(r.creatinine, 1.6);
  assert.strictEqual(r.gfrEstimated, true);
  assert.strictEqual(r.gfr, 55);
  assert.deepStrictEqual(r.suggestedDiseases, ["고혈압", "이상지질혈증", "신장병"]);
});

test("CKD-EPI 2021 계산", () => {
  assert.strictEqual(estimateGfr(1.0, 50, "male"), 92);
  assert.strictEqual(estimateGfr(0.7, 50, "female"), 105);
  assert.strictEqual(estimateGfr(null, 50, "male"), null);
});

test("Word 편집 기호(¶)가 '←', 'e' 로 읽혀도 키·몸무게를 읽는다", () => {
  const marked = docx.map((f) =>
    f.inferText === "신장" ? { ...f, inferText: "신장←" }
    : f.inferText === "체중" ? { ...f, inferText: "체중←" }
    : f.inferText === "68.5" ? { ...f, inferText: "68.5" }
    : f.inferText === "kg" ? { ...f, inferText: "kge" }
    : f,
  );
  const r = parseCheckup(marked, NOW);
  assert.strictEqual(r.height, 170.2);
  assert.strictEqual(r.weight, 68.5);
});
