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

// [추가] 1형 / 2형 당뇨 추천 (demo-checkups 검진표 글자를 단어 조각으로 나눈 가짜 OCR 결과, 좌표 없음)
const words = (text) => text.split(" ").map((w) => ({ inferText: w }));
const diabetesOf = (text) => parseCheckup(words(text), NOW).suggestedDiseases.filter((d) => d.includes("당뇨"));

test("검진표에 제1형 당뇨병이 적혀 있으면 2형 대신 1형 당뇨를 추천한다", () => {
  const type1 = "진단여부 제1형 당뇨병 약물치료여부 있음(인슐린) 당뇨병 식전혈당 182 mg/dL 100 미만 100 - 125";
  assert.deepStrictEqual(diabetesOf(type1), ["1형 당뇨"]);
  // OCR 이 1 을 l 로 읽거나 띄어 읽어도
  assert.deepStrictEqual(diabetesOf("진단여부 제 l형 당 뇨병 식전혈당 182 mg/dL"), ["1형 당뇨"]);
  assert.deepStrictEqual(diabetesOf("소견 1형당뇨 관리 중 식전혈당 110 mg/dL"), ["1형 당뇨"]);
});

test("1형 진단명이 없으면 예전처럼 혈당 126 이상이면 2형 당뇨", () => {
  assert.deepStrictEqual(diabetesOf("진단여부 당뇨병 약물치료여부 있음(경구혈당강하제) 당뇨병 식전혈당 148 mg/dL"), ["2형 당뇨"]);
  assert.deepStrictEqual(diabetesOf("진단여부 제2형 당뇨병 식전혈당 148 mg/dL"), ["2형 당뇨"]);
  // 인슐린을 쓴다는 것만으로는 1형이 아니다
  assert.deepStrictEqual(diabetesOf("약물치료여부 있음(인슐린) 식전혈당 150 mg/dL"), ["2형 당뇨"]);
  assert.deepStrictEqual(diabetesOf("진단여부 고혈압 식전혈당 94 mg/dL"), []);
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
