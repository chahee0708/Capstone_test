const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

process.env.JWT_SECRET = "test-secret";

const { MlServiceError, MlRequestError } = require("../services/errors");
const { normalizeBarcode, hasValidCheckDigit, isPlausibleBarcode } = require("../services/barcodeUtil");
const { validateLabelInput, toPer100 } = require("../services/labelService");
const { createFakeDb, createFakeNeo4j, createFakeMlClient, startServer } = require("../test-support/helpers");

const PASSWORD = "password123";
const hash = bcrypt.hashSync(PASSWORD, 4);

const users = () => [
  {
    id: 1, name: "홍길동", email: "user1@test.com", password: hash,
    age: 45, weight: 80, height: 170, gender: "male",
    diseases: '["고혈압"]', allergens: '["우유","밀"]', hypertension_stage: 1,
    ldl_value: null, tg_value: null, hdl_value: null, gfr_value: 35,
  },
  {
    id: 2, name: "정하나", email: "healthy@test.com", password: hash,
    age: 30, weight: 58, height: 163, gender: "female",
    diseases: "[]", allergens: "[]", hypertension_stage: 1,
    ldl_value: null, tg_value: null, hdl_value: null, gfr_value: 35,
  },
];

const FOODS = [
  {
    name: "생크림빵", manufacturer: "테스트베이커리", reportNo: "R-100",
    nutrition: { sodium: 300, sugar: 10, carbohydrate: 40, saturatedFat: 5, protein: 6, calories: 280, fat: 12 },
    ingredients: ["밀가루(밀:미국산)", "생크림", "설탕", "복합조미식품"],
  },
  { name: "생크림케이크", manufacturer: "다른회사", reportNo: "R-101", ingredients: ["설탕"] },
];

async function setup({ ml } = {}) {
  const db = createFakeDb(users());
  const neo = createFakeNeo4j({ foods: FOODS });
  const mlClient = createFakeMlClient(ml);
  // 실제 scoreForDiseaseUser 를 사용해 판정 파이프라인 전체를 검증한다
  const server = await startServer({ db, getSession: neo.getSession, mlClient });
  return { db, neo, mlClient, server };
}

async function login(server, email = "user1@test.com") {
  const c = server.client();
  const r = await c.post("/auth/login", { email, password: PASSWORD });
  assert.equal(r.status, 200);
  return c;
}

function imageForm(field = "image", { type = "image/png", name = "x.png", size = 64 } = {}) {
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array(size)], { type }), name);
  return form;
}

// ── 유틸 ──────────────────────────────────────────────────────────

test("바코드 번호 정규화/검증", () => {
  assert.equal(normalizeBarcode(" 880-1234 5678 90 "), "88012345678" + "90");
  assert.equal(isPlausibleBarcode("8801007088167"), true);
  assert.equal(isPlausibleBarcode("12345"), false);
  assert.equal(isPlausibleBarcode("88010070881ab"), false);
  // 실제 EAN-13 체크 숫자
  assert.equal(hasValidCheckDigit("8801007088167"), true);
  assert.equal(hasValidCheckDigit("8801007088168"), false);
  assert.equal(hasValidCheckDigit("4006381333931"), true); // 예시 EAN-13
  assert.equal(hasValidCheckDigit("96385074"), true); // 예시 EAN-8
});

test("라벨 입력 검증/환산: 70ml 기준 표시 → 100ml 기준", () => {
  const { value, errors } = validateLabelInput({
    nutrition: { energy_kcal: 175, sodium_mg: 75, carbohydrate_g: 21, sugar_g: 17, fat_g: 9 },
    referenceAmount: 70,
    ingredients: "정제수, 설탕",
  });
  assert.deepEqual(errors, []);
  const { nutrition, factor, missing } = toPer100(value.nutrition, value.referenceAmount);
  assert.ok(Math.abs(factor - 100 / 70) < 1e-9);
  assert.equal(nutrition.sodium, 107.14);
  assert.equal(nutrition.calories, 250);
  assert.ok(missing.includes("단백질"));
  assert.ok(missing.includes("트랜스지방"));
});

test("라벨 입력 검증: 범위/형식 오류와 빈 입력을 거부한다", () => {
  assert.ok(validateLabelInput({ nutrition: {} }).errors.length > 0);
  assert.ok(validateLabelInput({ nutrition: { sodium_mg: -1 } }).errors.length > 0);
  assert.ok(validateLabelInput({ nutrition: { sodium_mg: "abc" } }).errors.length > 0);
  assert.ok(validateLabelInput({ nutrition: { sodium_mg: 10 }, referenceAmount: 0 }).errors.length > 0);
  assert.ok(validateLabelInput(null).errors.length > 0);
  assert.equal(validateLabelInput({ nutrition: { sodium_mg: "1,200" } }).value.nutrition.sodium_mg, 1200);
});

// ── 검색 / 품목보고번호 분석 ────────────────────────────────────

test("검색: 제조사·품목보고번호를 함께 반환한다", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    const r = await c.get("/recommend/search?q=" + encodeURIComponent("생크림"));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((i) => i.reportNo).sort(), ["R-100", "R-101"]);
    assert.equal(r.body.items[0].manufacturer !== undefined, true);
  } finally {
    await server.close();
  }
});

test("품목보고번호로 같은 이름 제품 중 정확한 제품을 분석한다 + 알레르기 근거 포함", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    const r = await c.post("/recommend", { reportNo: "R-100" });
    assert.equal(r.status, 200);
    assert.equal(r.body.productName, "생크림빵");
    assert.equal(r.body.manufacturer, "테스트베이커리");
    assert.equal(r.body.source, "db");
    // 생크림 → 우유, 밀가루 → 밀
    assert.deepEqual(r.body.allergenAlert.sort(), ["밀", "우유"]);
    const milk = r.body.allergenMatches.find((m) => m.allergen === "우유");
    assert.equal(milk.severity, "contains");
    assert.equal(milk.evidence[0].keyword, "크림");
    // 복합조미식품 → 세부 성분 불투명 경고
    assert.deepEqual(r.body.allergenCoverage.opaqueIngredients, ["복합조미식품"]);
    assert.ok(Array.isArray(r.body.evaluations));
  } finally {
    await server.close();
  }
});

// ── 바코드 ──────────────────────────────────────────────────────

test("바코드 번호: 품목보고번호 → 식품 분석", async () => {
  const { server, mlClient } = await setup({
    ml: {
      async barcodeLookup(code) {
        return { status: "ok", code, report_no: "R-100", product_name: "생크림빵", manufacturer: "테스트베이커리" };
      },
    },
  });
  try {
    const c = await login(server);
    const r = await c.post("/recommend/barcode", { code: "880 1007 088167" });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "ok");
    assert.equal(r.body.code, "8801007088167");
    assert.equal(r.body.source, "barcode");
    assert.equal(r.body.reportNo, "R-100");
    assert.deepEqual(r.body.allergenAlert.sort(), ["밀", "우유"]);
    assert.deepEqual(mlClient.calls[0], ["barcodeLookup", "8801007088167"]);
  } finally {
    await server.close();
  }
});

test("바코드: 제품은 확인되지만 영양성분 DB에 없으면 no_nutrition + OCR 안내", async () => {
  const { server } = await setup({
    ml: {
      async barcodeLookup(code) {
        return { status: "ok", code, report_no: "NOT-IN-DB", product_name: "이름만 있는 제품", manufacturer: "어떤회사" };
      },
    },
  });
  try {
    const c = await login(server);
    const r = await c.post("/recommend/barcode", { code: "8801007088167" });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "no_nutrition");
    assert.equal(r.body.productName, "이름만 있는 제품");
    assert.equal(r.body.manufacturer, "어떤회사");
    assert.match(r.body.message, /영양성분표/);
  } finally {
    await server.close();
  }
});

test("바코드: 등록되지 않은 번호는 not_found, 체크 숫자 오류는 안내 문구 포함", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    const ok = await c.post("/recommend/barcode", { code: "8801007088167" });
    assert.equal(ok.body.status, "not_found");
    assert.doesNotMatch(ok.body.message, /잘못 읽/);
    const bad = await c.post("/recommend/barcode", { code: "8801007088168" });
    assert.equal(bad.body.status, "not_found");
    assert.match(bad.body.message, /잘못 읽/);
  } finally {
    await server.close();
  }
});

test("바코드: 형식이 잘못된 번호는 400", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    assert.equal((await c.post("/recommend/barcode", { code: "123" })).status, 400);
    assert.equal((await c.post("/recommend/barcode", {})).status, 400);
    assert.equal((await c.post("/recommend/barcode", { code: "abc" })).status, 400);
  } finally {
    await server.close();
  }
});

test("바코드 이미지: 디코딩 성공 → 분석, 실패 → decode_failed, 파일 없음 → 400, 이미지 아님 → 400", async () => {
  const { server, mlClient } = await setup({
    ml: {
      async barcodeDecode(file) {
        if (file.originalname === "ok.png") {
          return { status: "ok", code: "8801007088167", report_no: "R-100", product_name: "생크림빵", manufacturer: "테스트베이커리" };
        }
        return { status: "decode_failed" };
      },
    },
  });
  try {
    const c = await login(server);

    const ok = await c.postForm("/recommend/barcode/image", imageForm("image", { name: "ok.png" }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, "ok");
    assert.equal(ok.body.code, "8801007088167");
    assert.equal(ok.body.productName, "생크림빵");

    const failed = await c.postForm("/recommend/barcode/image", imageForm("image", { name: "blur.png" }));
    assert.equal(failed.status, 200);
    assert.equal(failed.body.status, "decode_failed");

    const empty = await c.postForm("/recommend/barcode/image", new FormData());
    assert.equal(empty.status, 400);

    const notImage = await c.postForm("/recommend/barcode/image", imageForm("image", { type: "text/plain", name: "a.txt" }));
    assert.equal(notImage.status, 400);

    assert.ok(mlClient.calls.filter((c2) => c2[0] === "barcodeDecode").length >= 2);
  } finally {
    await server.close();
  }
});

test("바코드: ML 서비스 장애는 503, 인증 없으면 401", async () => {
  const { server } = await setup({
    ml: {
      async barcodeLookup() {
        throw new MlServiceError("down");
      },
    },
  });
  try {
    const anon = server.client();
    assert.equal((await anon.post("/recommend/barcode", { code: "8801007088167" })).status, 401);
    const c = await login(server);
    const r = await c.post("/recommend/barcode", { code: "8801007088167" });
    assert.equal(r.status, 503);
  } finally {
    await server.close();
  }
});

// ── 라벨(OCR/직접 입력) 분석 ─────────────────────────────────────

test("라벨 분석: 표시 기준량 환산 + 알레르기(크림→우유) + 불투명 원료 경고", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    const r = await c.post("/recommend/label", {
      productName: "내가 찍은 빵",
      nutrition: { energy_kcal: 200, sodium_mg: 600, carbohydrate_g: 30, sugar_g: 8, fat_g: 6, saturated_fat_g: 2, trans_fat_g: 0, protein_g: 5 },
      referenceAmount: 50, // 50g 당 표시 → 100g 환산
      ingredients: "밀가루, 크림, 설탕, 복합조미식품",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.source, "ocr");
    assert.equal(r.body.productName, "내가 찍은 빵");
    assert.equal(r.body.nutrition.sodium, 1200); // 600mg/50g → 1200mg/100g
    assert.equal(r.body.label.factor, 2);
    assert.deepEqual(r.body.label.missingNutrients, []);
    assert.deepEqual(r.body.allergenAlert.sort(), ["밀", "우유"]);
    const milk = r.body.allergenMatches.find((m) => m.allergen === "우유");
    assert.equal(milk.evidence[0].ingredient, "크림");
    assert.deepEqual(r.body.allergenCoverage.opaqueIngredients, ["복합조미식품"]);
    // 고혈압: 나트륨 1200mg/100g 은 1일 한도 2400mg 의 50% → 비추천
    assert.equal(r.body.verdict, "비추천");
    assert.ok(r.body.evaluations.some((e) => e.nutrient === "나트륨" && e.percent === 50));
  } finally {
    await server.close();
  }
});

test("라벨 분석: 라벨의 '함유' 표시 문구와 혼입 가능(cross)을 반영한다", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    const r = await c.post("/recommend/label", {
      nutrition: { sodium_mg: 100, sugar_g: 1 },
      ingredients: "정제수, 설탕, 혼합제제\n우유 함유\n밀을 사용한 제품과 같은 제조시설에서 제조",
    });
    assert.equal(r.status, 200);
    const milk = r.body.allergenMatches.find((m) => m.allergen === "우유");
    const wheat = r.body.allergenMatches.find((m) => m.allergen === "밀");
    assert.equal(milk.level, "declared");
    assert.equal(milk.severity, "contains");
    assert.equal(wheat.level, "cross");
    assert.equal(wheat.severity, "may_contain");
    assert.ok(r.body.label.missingNutrients.length > 0);
  } finally {
    await server.close();
  }
});

test("라벨 분석: 잘못된 입력 400, 질환 없는 사용자는 안내", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    assert.equal((await c.post("/recommend/label", { nutrition: {} })).status, 400);
    assert.equal((await c.post("/recommend/label", { nutrition: { sodium_mg: -5 } })).status, 400);

    const h = await login(server, "healthy@test.com");
    const r = await h.post("/recommend/label", { nutrition: { sodium_mg: 100 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.userType, "healthy");
  } finally {
    await server.close();
  }
});

// ── OCR 라우트 ──────────────────────────────────────────────────

test("OCR 라벨: ML 결과를 정리하고 표시 문구/원재료 기반 알레르기를 미리보기로 제공", async () => {
  const { server, mlClient } = await setup({
    ml: {
      async ocrLabel(files) {
        assert.equal(files.length, 2);
        return {
          status: "ok",
          product: { name: "돼지바", manufacturer: "롯데웰푸드", report_no: "200504480017" },
          reference: { amount: 70, unit: "ml", text: "총 내용량 70ml", basis: "total" },
          nutrition: { energy_kcal: 175, sodium_mg: 75, carbohydrate_g: 21, sugar_g: 1, fat_g: 9, protein_g: 2 },
          // 라벨에 "1g 미만" 으로 인쇄된 당류, 그리고 값이 없는 항목의 한정어(무시되어야 함)
          qualifiers: { sugar_g: "lt", fiber_x: "lt", dietary_fiber_g: "lt" },
          ingredients: "정제수, 비스켓분태[밀가루(밀:미국산)], 혼합분유, 버터, 딸기잼",
          ingredient_corrections: [{ from: "데스트린", to: "덱스트린" }, { from: 3 }, null],
          allergy_text: "밀,땅콩,대두,우유 함유",
          warnings: [{ code: "LOW_CONFIDENCE", message: "일부 글자가 불확실합니다." }],
          confidence: 0.82,
          raw_text: "…",
        };
      },
    },
  });
  try {
    const c = await login(server);
    const form = new FormData();
    form.append("images", new Blob([new Uint8Array(10)], { type: "image/jpeg" }), "a.jpg");
    form.append("images", new Blob([new Uint8Array(10)], { type: "image/png" }), "b.png");
    const r = await c.postForm("/ocr/label", form);
    assert.equal(r.status, 200);
    assert.equal(r.body.product.name, "돼지바");
    assert.equal(r.body.product.reportNo, "200504480017");
    assert.equal(r.body.reference.amount, 70);
    assert.equal(r.body.nutrition.sodium_mg, 75);
    assert.equal(r.body.nutrition.potassium_mg, null);
    // "1g 미만" 한정어는 값이 있는 항목에만 전달된다
    assert.deepEqual(r.body.qualifiers, { sugar_g: "lt" });
    assert.deepEqual(r.body.ingredientCorrections, [{ from: "데스트린", to: "덱스트린" }]);
    assert.deepEqual(r.body.allergens.declared.sort(), ["대두", "땅콩", "밀", "우유"]);
    const detected = r.body.allergens.detected.map((d) => d.allergen);
    assert.ok(detected.includes("밀") && detected.includes("우유"));
    assert.equal(r.body.warnings[0].code, "LOW_CONFIDENCE");
    assert.equal(mlClient.calls[0][0], "ocrLabel");
  } finally {
    await server.close();
  }
});

test("OCR 라벨: 로그인 필요, 파일 없음 400, 이미지 아님 400, ML 장애 503", async () => {
  const { server } = await setup({
    ml: {
      async ocrLabel() {
        throw new MlServiceError("down");
      },
    },
  });
  try {
    const anon = server.client();
    assert.equal((await anon.postForm("/ocr/label", imageForm("images"))).status, 401);

    const c = await login(server);
    assert.equal((await c.postForm("/ocr/label", new FormData())).status, 400);
    assert.equal((await c.postForm("/ocr/label", imageForm("images", { type: "application/pdf", name: "a.pdf" }))).status, 400);
    assert.equal((await c.postForm("/ocr/label", imageForm("images"))).status, 503);
  } finally {
    await server.close();
  }
});

test("OCR 라벨: ML 이 이미지를 거부하면(MlRequestError) 400 으로 전달", async () => {
  const { server } = await setup({
    ml: {
      async ocrLabel() {
        throw new MlRequestError("이미지를 읽을 수 없습니다.", 400);
      },
    },
  });
  try {
    const c = await login(server);
    const r = await c.postForm("/ocr/label", imageForm("images"));
    assert.equal(r.status, 400);
    assert.match(r.body.message, /이미지/);
  } finally {
    await server.close();
  }
});

test("OCR 건강검진: 로그인 없이 사용 가능(가입 화면), 프로필 항목을 정리해 반환", async () => {
  const { server } = await setup({
    ml: {
      async ocrCheckup() {
        return {
          status: "ok",
          profile: { age: 52, gender: "female", height_cm: 160, weight_kg: 58.5, ldl_value: 165, tg_value: 220, hdl_value: 38, systolic: 150, diastolic: 95, hypertension_stage: 1 },
          diseases: ["고혈압"],
          suggested_diseases: [{ name: "이상지질혈증", reason: "LDL 165 mg/dL (160 이상)" }],
          allergens: [],
          warnings: [],
          confidence: 0.7,
        };
      },
    },
  });
  try {
    const anon = server.client();
    const r = await anon.postForm("/ocr/checkup", imageForm("image"));
    assert.equal(r.status, 200);
    assert.equal(r.body.profile.age, 52);
    assert.equal(r.body.profile.gender, "female");
    assert.equal(r.body.profile.height, 160);
    assert.equal(r.body.profile.weight, 58.5);
    assert.equal(r.body.profile.ldl_value, 165);
    assert.equal(r.body.vitals.systolic, 150);
    assert.deepEqual(r.body.diseases, ["고혈압"]);
    assert.equal(r.body.suggestedDiseases[0].name, "이상지질혈증");
  } finally {
    await server.close();
  }
});

test("OCR 요청 제한: 짧은 시간에 반복하면 429", async () => {
  const { createApp } = require("../app");
  const db = createFakeDb(users());
  const neo = createFakeNeo4j({ foods: FOODS });
  const app = createApp({ db, getSession: neo.getSession, mlClient: createFakeMlClient(), enableRateLimit: true });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/ocr/checkup`;
    let last;
    for (let i = 0; i < 12; i++) {
      last = await fetch(url, { method: "POST", body: imageForm("image") });
    }
    assert.equal(last.status, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
