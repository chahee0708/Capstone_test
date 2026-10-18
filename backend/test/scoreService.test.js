const test = require("node:test");
const assert = require("node:assert/strict");

const {
  scoreForDiseaseUser,
  evaluateDyslipidemia,
  evaluateRuleDiseases,
  callMLService,
  MlServiceError,
  getDailyReference,
} = require("../services/scoreService");

// 100g 당 영양성분 (모든 값 0 → 모든 영양소 "추천")
function nutrition(overrides = {}) {
  return {
    sugar: 0,
    sodium: 0,
    saturatedFat: 0,
    protein: 0,
    calories: 0,
    carbohydrate: 0,
    fat: 0,
    transFat: 0,
    cholesterol: 0,
    fiber: 0,
    potassium: 0,
    phosphorus: 0,
    ...overrides,
  };
}

const kdri = getDailyReference("male", 45); // 에너지 2500

test("이상지질혈증: HDL 미입력(null)을 '낮음'으로 판정하지 않는다", () => {
  // 탄수화물 한도: HDL 낮음이면 에너지 65% → 406g, 수치가 모두 정상이면 탄수화물은 평가되지 않는다.
  const r = evaluateDyslipidemia(nutrition({ carbohydrate: 200 }), 2500, null, null, null);
  assert.equal(r.verdict, "추천");
  assert.deepEqual(r.warnings, []);
});

test("이상지질혈증: HDL < 40 이면 탄수화물이 평가된다", () => {
  // HDL 낮음 → 탄수화물 한도 (2500*0.65/4)=406g, 25% = 101g 초과 → 비추천
  const r = evaluateDyslipidemia(nutrition({ carbohydrate: 200 }), 2500, null, null, 38);
  assert.equal(r.verdict, "비추천");
});

test("규칙 판정: 체중 누락(NaN 한도)이어도 단백질을 잘못 '추천'으로 만들지 않고 건너뛴다", () => {
  const r = evaluateRuleDiseases(nutrition({ protein: 500 }), ["신장병"], {
    weight: null,
    kdri,
    diseaseDetails: { gfr_value: 35 },
  });
  // 단백질은 평가 불가 → 나트륨(0)만 평가되어 추천. NaN 비교로 인한 오동작이 없어야 한다.
  assert.equal(r.verdict, "추천");
  assert.deepEqual(r.evaluated, ["신장병"]);
});

test("복합 질환: 2형 당뇨(ML=Low) + 신장병(나트륨 높음) → 가장 보수적인 '비추천'", async () => {
  const result = await scoreForDiseaseUser(
    {},
    "라면",
    ["2형 당뇨", "신장병"],
    70, 170, 45, "male",
    { gfr_value: 35 },
    {
      getNutrition: async () => nutrition({ sodium: 2000 }), // 3000mg*25% = 750 초과
      callML: async () => ({ gi_category: "Low" }),
    },
  );
  assert.equal(result.verdict, "비추천");
  assert.equal(result.giCategory, "Low");
  assert.equal(result.diseaseTrack, "diabetes");
  assert.deepEqual(result.evaluatedDiseases, ["2형 당뇨", "신장병"]);
  assert.ok(result.warnings.some((w) => w.includes("나트륨")));
});

test("2형 당뇨만 보유: ML 결과가 verdict 가 된다", async () => {
  const run = (gi) =>
    scoreForDiseaseUser({}, "빵", ["2형 당뇨"], 70, 170, 45, "male", {}, {
      getNutrition: async () => nutrition(),
      callML: async () => ({ gi_category: gi }),
    });
  assert.equal((await run("Low")).verdict, "추천");
  assert.equal((await run("Medium")).verdict, "주의");
  assert.equal((await run("High")).verdict, "비추천");
});

test("공백이 다른 질환명('2형당뇨')도 같은 질환으로 인식한다", async () => {
  let mlCalled = false;
  const result = await scoreForDiseaseUser({}, "빵", ["2형당뇨"], 70, 170, 45, "male", {}, {
    getNutrition: async () => nutrition(),
    callML: async () => {
      mlCalled = true;
      return { gi_category: "Low" };
    },
  });
  assert.ok(mlCalled);
  assert.equal(result.diseaseTrack, "diabetes");
});

test("지원하지 않는 질환만 있으면 '추천'을 만들지 않고 unsupported 를 반환한다", async () => {
  const result = await scoreForDiseaseUser({}, "빵", ["갑상선 질환"], 70, 170, 45, "male", {}, {
    getNutrition: async () => nutrition(),
    callML: async () => {
      throw new Error("호출되면 안 됨");
    },
  });
  assert.equal(result.unsupported, true);
  assert.deepEqual(result.unsupportedDiseases, ["갑상선 질환"]);
});

test("지원 질환 + 미지원 질환 혼합: 지원 질환만 판정하고 미지원 목록을 알려준다", async () => {
  const result = await scoreForDiseaseUser({}, "빵", ["고혈압", "갑상선 질환"], 70, 170, 45, "male", {}, {
    getNutrition: async () => nutrition(),
  });
  assert.equal(result.verdict, "추천");
  assert.deepEqual(result.unsupportedDiseases, ["갑상선 질환"]);
});

test("음식이 없으면 null", async () => {
  const result = await scoreForDiseaseUser({}, "없는음식", ["고혈압"], 70, 170, 45, "male", {}, {
    getNutrition: async () => null,
  });
  assert.equal(result, null);
});

// ── ML 호출 ────────────────────────────────────────────────────

test("callMLService: 정상 응답", async () => {
  const fakeFetch = async (url, init) => {
    assert.match(url, /\/predict$/);
    const body = JSON.parse(init.body);
    assert.equal(body.fiber, 3); // 하드코딩 0 이 아니라 실제 값을 전달
    return { ok: true, status: 200, json: async () => ({ gi_category: "High" }) };
  };
  const r = await callMLService(nutrition({ fiber: 3 }), fakeFetch);
  assert.equal(r.gi_category, "High");
});

test("callMLService: 연결 실패는 MlServiceError", async () => {
  const fakeFetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(() => callMLService(nutrition(), fakeFetch), MlServiceError);
});

test("callMLService: 500 응답은 MlServiceError", async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => callMLService(nutrition(), fakeFetch), MlServiceError);
});

test("callMLService: JSON 이 아닌 응답은 프로세스를 죽이지 않고 MlServiceError", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
  });
  await assert.rejects(() => callMLService(nutrition(), fakeFetch), MlServiceError);
});

test("callMLService: 알 수 없는 카테고리는 MlServiceError", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ gi_category: "Weird" }) });
  await assert.rejects(() => callMLService(nutrition(), fakeFetch), MlServiceError);
});
