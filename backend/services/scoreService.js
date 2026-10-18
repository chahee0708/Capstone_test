/**
 * scoreService.js
 *
 * 역할: 사용자의 질병 종류 및 심각도에 따라 음식 적합성을 판정하는 서비스
 *
 * 판정 트랙:
 *   - 2형 당뇨      → Python ML 서비스 (GI Category 기반)
 *   - 고혈압        → 규칙 기반 (나트륨, Stage I/II)
 *   - 이상지질혈증  → 규칙 기반 (포화지방, 트랜스지방, 콜레스테롤, LDL 심각도별)
 *   - 1형 당뇨      → 규칙 기반 (당류, 탄수화물)
 *   - 신장병        → 규칙 기반 (나트륨, 단백질, GFR 단계별)
 *   - 갑상선        → 미구현 (요오드 데이터 없음, 완전 제외)
 *
 * 판정 공식 근거: 영국 FoP 가이드라인 (UK DoH/FSA, 2016, Annex 3 Table 2, p.19)
 *   HIGH(비추천) = 질병별 1일 한도 × 25% / 100g 초과
 *   LOW(추천)   = 질병별 1일 한도 × ~5% / 100g 이하 (EU 1924/2006 근사값)
 *
 * 여러 질병 동시 보유 시: 각 질병별 독립 판정 후 가장 보수적 판정 채택
 */

const config = require("../config");
const { getFoodNutrition } = require("./foodService");
const { MlServiceError } = require("./errors");

// ─────────────────────────────────────────────────────────────
// KDRI 테이블 (한국인 영양소 섭취기준, 한국영양학회 2020)
// 에너지 단위: kcal/일, 나머지: g/일 또는 mg/일
// ─────────────────────────────────────────────────────────────
const KDRI = {
  male: {
    "6~8": {
      에너지: 1700,
      나트륨: 1700,
      당류: 85,
      탄수화물: 130,
      단백질: 35,
      식이섬유: 20,
    },
    "9~11": {
      에너지: 2000,
      나트륨: 2000,
      당류: 100,
      탄수화물: 130,
      단백질: 50,
      식이섬유: 20,
    },
    "12~14": {
      에너지: 2500,
      나트륨: 2300,
      당류: 125,
      탄수화물: 130,
      단백질: 60,
      식이섬유: 25,
    },
    "15~18": {
      에너지: 2700,
      나트륨: 2300,
      당류: 135,
      탄수화물: 130,
      단백질: 65,
      식이섬유: 25,
    },
    "19~29": {
      에너지: 2600,
      나트륨: 2300,
      당류: 130,
      탄수화물: 130,
      단백질: 65,
      식이섬유: 30,
    },
    "30~49": {
      에너지: 2500,
      나트륨: 2300,
      당류: 125,
      탄수화물: 130,
      단백질: 65,
      식이섬유: 30,
    },
    "50~64": {
      에너지: 2200,
      나트륨: 2300,
      당류: 110,
      탄수화물: 130,
      단백질: 60,
      식이섬유: 30,
    },
    "65~74": {
      에너지: 2000,
      나트륨: 1900,
      당류: 100,
      탄수화물: 130,
      단백질: 60,
      식이섬유: 30,
    },
    "75이상": {
      에너지: 1900,
      나트륨: 1800,
      당류: 95,
      탄수화물: 130,
      단백질: 60,
      식이섬유: 30,
    },
  },
  female: {
    "6~8": {
      에너지: 1500,
      나트륨: 1700,
      당류: 75,
      탄수화물: 130,
      단백질: 35,
      식이섬유: 15,
    },
    "9~11": {
      에너지: 1800,
      나트륨: 2000,
      당류: 90,
      탄수화물: 130,
      단백질: 45,
      식이섬유: 20,
    },
    "12~14": {
      에너지: 2000,
      나트륨: 2300,
      당류: 100,
      탄수화물: 130,
      단백질: 55,
      식이섬유: 20,
    },
    "15~18": {
      에너지: 2000,
      나트륨: 2300,
      당류: 100,
      탄수화물: 130,
      단백질: 55,
      식이섬유: 20,
    },
    "19~29": {
      에너지: 2000,
      나트륨: 2300,
      당류: 100,
      탄수화물: 130,
      단백질: 55,
      식이섬유: 20,
    },
    "30~49": {
      에너지: 1900,
      나트륨: 2300,
      당류: 95,
      탄수화물: 130,
      단백질: 50,
      식이섬유: 20,
    },
    "50~64": {
      에너지: 1700,
      나트륨: 2300,
      당류: 85,
      탄수화물: 130,
      단백질: 50,
      식이섬유: 25,
    },
    "65~74": {
      에너지: 1600,
      나트륨: 1900,
      당류: 80,
      탄수화물: 130,
      단백질: 50,
      식이섬유: 25,
    },
    "75이상": {
      에너지: 1500,
      나트륨: 1800,
      당류: 75,
      탄수화물: 130,
      단백질: 50,
      식이섬유: 25,
    },
  },
};

// ─────────────────────────────────────────────────────────────
// 유틸 함수
// ─────────────────────────────────────────────────────────────

function getAgeGroup(age) {
  if (age <= 8) return "6~8";
  if (age <= 11) return "9~11";
  if (age <= 14) return "12~14";
  if (age <= 18) return "15~18";
  if (age <= 29) return "19~29";
  if (age <= 49) return "30~49";
  if (age <= 64) return "50~64";
  if (age <= 74) return "65~74";
  return "75이상";
}

/**
 * 성별 + 나이로 KDRI 1일 기준값 조회
 * recommend.js에서 export해서 dailyReference로 프론트에 전달
 */
function getDailyReference(gender, age) {
  const genderKey = gender === "male" || gender === "남성" ? "male" : "female";
  return KDRI[genderKey][getAgeGroup(age)];
}

/**
 * 영국 FoP 25%/5% 공식으로 임계값 계산
 * 근거: UK DoH/FSA FoP Guidance (2016), Annex 3 Table 2, p.19
 *
 * @param {number} dailyLimit - 질병별 1일 한도
 * @returns {{ high: number, low: number }}
 */
function calcThreshold(dailyLimit) {
  return {
    high: dailyLimit * 0.25, // 1일 한도의 25% 초과 → 비추천
    low: dailyLimit * 0.05, // 1일 한도의 ~5% 이하 → 추천 (EU 1924/2006 근사값)
  };
}

/**
 * 영양소 값과 임계값 비교 → 등급 반환
 */
function evaluateNutrient(value, dailyLimit) {
  const threshold = calcThreshold(dailyLimit);
  const percent = Math.round((value / dailyLimit) * 100);
  if (value > threshold.high) return { level: "high", percent };
  if (value > threshold.low) return { level: "mid", percent };
  return { level: "low", percent };
}

const LEVEL_RANK = { low: 0, mid: 1, high: 2 };
const VERDICT_RANK = { 추천: 0, 주의: 1, 비추천: 2 };
const VERDICT_BY_RANK = ["추천", "주의", "비추천"];

/**
 * 영양소 평가 목록을 종합해서 최종 verdict 반환
 * 가장 나쁜 영양소 기준으로 최종 판정 (보수적 판정 원칙)
 *
 * @param {Array} evaluations - [{ nutrientName, value, dailyLimit }]
 * @returns {{ verdict, warnings }}
 */
function combineResults(evaluations) {
  const warnings = [];
  const items = [];
  let worstRank = 0;

  for (const { nutrientName, value, dailyLimit } of evaluations) {
    // 값이 없거나 숫자가 아니면 스킵 (Neo4j에 없는 영양소)
    if (value === undefined || value === null || !Number.isFinite(value)) continue;
    // 1일 한도를 계산할 수 없으면(체중 누락 등) 잘못된 "추천"을 만들지 않도록 스킵
    if (!Number.isFinite(dailyLimit) || dailyLimit <= 0) continue;

    const { level, percent } = evaluateNutrient(value, dailyLimit);
    items.push({ nutrient: nutrientName, value, dailyLimit, percent, level });

    if (level === "high") {
      warnings.push(`${nutrientName} 높음 (1일 기준 ${percent}%) — 비추천`);
    } else if (level === "mid") {
      warnings.push(`${nutrientName} 보통 (1일 기준 ${percent}%) — 주의`);
    }

    worstRank = Math.max(worstRank, LEVEL_RANK[level]);
  }

  const verdict =
    worstRank === 2 ? "비추천" : worstRank === 1 ? "주의" : "추천";

  return { verdict, warnings, items };
}

function calcBMI(weight, height) {
  const h = height / 100;
  return weight / (h * h);
}

// ─────────────────────────────────────────────────────────────
// ML 서비스 호출 (2형 당뇨 전용)
// ─────────────────────────────────────────────────────────────
const ML_CATEGORIES = new Set(["Low", "Medium", "High"]);

/**
 * ML 서비스(/predict) 호출.
 * - 타임아웃을 두고, 연결 실패/비정상 상태코드/잘못된 응답은 MlServiceError 로 통일한다.
 *   (이전 구현은 응답 JSON.parse 예외가 이벤트 핸들러에서 발생해 프로세스가 종료될 수 있었다.)
 * - fetchImpl 은 테스트에서 주입한다.
 */
async function callMLService(nutrition, fetchImpl = fetch) {
  const body = {
    calories: nutrition.calories,
    protein: nutrition.protein,
    fats: nutrition.fat,
    carbs: nutrition.carbohydrate,
    fiber: nutrition.fiber ?? 0,
    sugar: nutrition.sugar,
    phosphorus: nutrition.phosphorus ?? 0,
    potassium: nutrition.potassium ?? 0,
    sodium: nutrition.sodium,
    saturated_fat: nutrition.saturatedFat,
    trans_fat: nutrition.transFat,
  };

  let res;
  try {
    res = await fetchImpl(`${config.ML_SERVICE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.ML_TIMEOUT_MS),
    });
  } catch (err) {
    throw new MlServiceError("ML 서비스에 연결할 수 없습니다.", err);
  }

  if (!res.ok) {
    throw new MlServiceError(`ML 서비스 오류 응답 (${res.status})`);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new MlServiceError("ML 서비스 응답을 해석할 수 없습니다.", err);
  }

  if (!data || !ML_CATEGORIES.has(data.gi_category)) {
    throw new MlServiceError("ML 서비스가 올바르지 않은 결과를 반환했습니다.");
  }
  return data;
}

// ─────────────────────────────────────────────────────────────
// 질병별 판정 함수
// ─────────────────────────────────────────────────────────────

/**
 * 고혈압 판정
 *
 * 근거:
 *   - Stage I (나트륨 2400mg): Whelton PK et al., JACC 2018, Section 8
 *   - Stage II (나트륨 1500mg): Sacks FM et al., NEJM 2001, DASH-Sodium
 *
 * TODO: 칼륨 — Neo4j 데이터 보강 후 추가
 *
 * @param {object} nutrition
 * @param {number} stage - 1 또는 2
 */
function evaluateHypertension(nutrition, stage) {
  const sodiumLimit = stage === 2 ? 1500 : 2400;

  return combineResults([
    {
      nutrientName: "나트륨",
      value: nutrition.sodium,
      dailyLimit: sodiumLimit,
    },
    // { nutrientName: "칼륨", value: nutrition.potassium, dailyLimit: 3500 }, // TODO
  ]);
}

/**
 * 이상지질혈증 판정
 *
 * 근거: 한국지질동맥경화학회 이상지질혈증 진료지침 제5판 (2022) Chapter 3
 *
 * @param {object} nutrition
 * @param {number} energy   - KDRI 1일 에너지 (kcal)
 * @param {number} ldlValue - LDL 콜레스테롤 수치 (mg/dL)
 * @param {number} tgValue  - 중성지방 수치 (mg/dL)
 * @param {number} hdlValue - HDL 콜레스테롤 수치 (mg/dL)
 */
function evaluateDyslipidemia(nutrition, energy, ldlValue, tgValue, hdlValue) {
  // 수치 미입력(null/undefined)은 "정상"으로 간주한다.
  // (JS 에서 null < 40 은 true 라서, 미입력 HDL 이 "낮음"으로 판정되던 버그를 막는다.)
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  // LDL: 0=정상(<130), 1=경계(130~159), 2=높음(160~189), 3=매우높음(≥190)
  const ldlSev = !isNum(ldlValue) ? 0 :
    ldlValue >= 190 ? 3 :
    ldlValue >= 160 ? 2 :
    ldlValue >= 130 ? 1 : 0;

  // TG: 0=정상(<150), 1=경계(150~199), 2=높음(200~499), 3=매우높음(≥500)
  const tgSev = !isNum(tgValue) ? 0 :
    tgValue >= 500 ? 3 :
    tgValue >= 200 ? 2 :
    tgValue >= 150 ? 1 : 0;

  // HDL: 0=정상(≥40), 1=낮음(<40)
  const hdlLow = isNum(hdlValue) && hdlValue < 40 ? 1 : 0;

  const nutrients = [];

  // 포화지방
  if (tgSev >= 2) {
    nutrients.push({ nutrientName: "포화지방", value: nutrition.saturatedFat, dailyLimit: (energy * 0.05) / 9 });
  } else if (ldlSev >= 1 || tgSev === 1) {
    nutrients.push({ nutrientName: "포화지방", value: nutrition.saturatedFat, dailyLimit: (energy * 0.07) / 9 });
  }

  // 트랜스지방 (항상 판정)
  nutrients.push({ nutrientName: "트랜스지방", value: nutrition.transFat, dailyLimit: (energy * 0.01) / 9 });

  // 탄수화물
  if (tgSev === 3) {
    nutrients.push({ nutrientName: "탄수화물", value: nutrition.carbohydrate, dailyLimit: (energy * 0.50) / 4 });
  } else if (tgSev === 2) {
    nutrients.push({ nutrientName: "탄수화물", value: nutrition.carbohydrate, dailyLimit: (energy * 0.55) / 4 });
  } else if (tgSev === 1) {
    nutrients.push({ nutrientName: "탄수화물", value: nutrition.carbohydrate, dailyLimit: (energy * 0.60) / 4 });
  } else if (hdlLow === 1) {
    nutrients.push({ nutrientName: "탄수화물", value: nutrition.carbohydrate, dailyLimit: (energy * 0.65) / 4 });
  }

  // 당류
  if (tgSev === 3) {
    nutrients.push({ nutrientName: "당류", value: nutrition.sugar, dailyLimit: (energy * 0.05) / 4 });
  } else if (tgSev >= 1) {
    nutrients.push({ nutrientName: "당류", value: nutrition.sugar, dailyLimit: (energy * 0.10) / 4 });
  }

  return combineResults(nutrients);
}

/**
 * 1형 당뇨 판정
 *
 * 근거:
 *   - 당류: ADA Standards 2024, Section 5, p.S77 (에너지 10% 미만)
 *   - 탄수화물: KDRI 권장값 130g/일
 *   - 심각도 구분 없음: ADA 검토 결과 HbA1c와 무관하게 동일 기준 적용
 *
 * @param {object} nutrition
 * @param {number} energy - KDRI 1일 에너지 (kcal)
 * @param {object} kdri   - KDRI 1일 기준값 객체
 */
function evaluateType1Diabetes(nutrition, energy, kdri) {
  // 당류: 1일 섭취열량의 10% → g 변환 (당류 1g = 4kcal)
  const sugarLimit = (energy * 0.1) / 4;

  return combineResults([
    { nutrientName: "당류", value: nutrition.sugar, dailyLimit: sugarLimit },
    {
      nutrientName: "탄수화물",
      value: nutrition.carbohydrate,
      dailyLimit: kdri.탄수화물,
    },
  ]);
}

/**
 * 신장병(CKD) 판정
 *
 * 근거:
 *   - 단백질: KDIGO 2024, Chapter 3, p.117~125
 *     GFR 0 (이식환자): 0.9g/kg/일 (0.8~1.0 중간값)
 *     GFR 1~19 (말기):  0.4g/kg/일 (0.3~0.5 중간값)
 *     GFR 20~50 (중기): 0.7g/kg/일 (0.6~0.8 중간값)
 *   - 나트륨: 3000mg/일 (대한신장학회 가이드라인)
 *
 * TODO: 인(phosphorus), 칼륨(potassium) — Neo4j 데이터 보강 후 추가
 *
 * @param {object} nutrition
 * @param {number} weight - 체중 (kg)
 * @param {number} gfr    - GFR 수치 (0 = 이식환자)
 */
function evaluateCKD(nutrition, weight, gfr) {
  const sodiumLimit = 3000; // mg/일

  // GFR 단계별 단백질 계수
  const proteinPerKg =
    gfr === 0
      ? 0.9 // 이식 환자
      : gfr < 20
        ? 0.4 // GFR 20 미만 (말기)
        : 0.7; // GFR 20~50 (중기)

  const proteinLimit = proteinPerKg * weight; // g/일

  return combineResults([
    {
      nutrientName: "나트륨",
      value: nutrition.sodium,
      dailyLimit: sodiumLimit,
    },
    {
      nutrientName: "단백질",
      value: nutrition.protein,
      dailyLimit: proteinLimit,
    },
    // { nutrientName: "인",   value: nutrition.phosphorus, dailyLimit: 900 }, // TODO
    // { nutrientName: "칼륨", value: nutrition.potassium,  dailyLimit: 2000 }, // TODO
  ]);
}

// ─────────────────────────────────────────────────────────────
// 메인 판정 함수
// ─────────────────────────────────────────────────────────────

/**
 * 질환명 정규화: 공백을 제거해 "2형 당뇨" / "2형당뇨" 를 같은 질환으로 취급한다.
 */
function normalizeDiseaseName(name) {
  return String(name || "").replace(/\s+/g, "");
}

const DIABETES_T2 = normalizeDiseaseName("2형 당뇨");
const DIABETES_T1 = normalizeDiseaseName("1형 당뇨");
const HYPERTENSION = normalizeDiseaseName("고혈압");
const DYSLIPIDEMIA = normalizeDiseaseName("이상지질혈증");
const CKD = normalizeDiseaseName("신장병");

/**
 * GI 카테고리 → verdict
 */
function verdictFromGi(giCategory) {
  if (giCategory === "High") return "비추천";
  if (giCategory === "Medium") return "주의";
  return "추천";
}

/**
 * 규칙 기반 질환들(고혈압/이상지질혈증/1형 당뇨/신장병) 판정
 * 순수 함수 — 질환별 독립 판정 후 warnings 합산, 가장 나쁜 verdict 채택
 *
 * @returns {{ verdict: string|null, warnings: string[], evaluated: string[], unsupported: string[] }}
 *   verdict 가 null 이면 규칙 기반으로 평가된 질환이 하나도 없다는 뜻
 */
function evaluateRuleDiseases(nutrition, diseases, ctx) {
  const { weight, kdri, diseaseDetails = {} } = ctx;
  const warnings = [];
  const evaluated = [];
  const unsupported = [];
  const evalByNutrient = new Map(); // 같은 영양소는 가장 엄격한 기준(비율 최대)만 남긴다
  let worstRank = -1;

  for (const disease of diseases) {
    const key = normalizeDiseaseName(disease);
    let result = null;

    if (key === HYPERTENSION) {
      const stage = diseaseDetails.hypertension_stage || 1;
      result = evaluateHypertension(nutrition, stage);
    } else if (key === DYSLIPIDEMIA) {
      result = evaluateDyslipidemia(
        nutrition,
        kdri.에너지,
        diseaseDetails.ldl_value,
        diseaseDetails.tg_value,
        diseaseDetails.hdl_value,
      );
    } else if (key === DIABETES_T1) {
      result = evaluateType1Diabetes(nutrition, kdri.에너지, kdri);
    } else if (key === CKD) {
      const gfr =
        diseaseDetails.gfr_value !== undefined && diseaseDetails.gfr_value !== null
          ? diseaseDetails.gfr_value
          : 35;
      result = evaluateCKD(nutrition, weight, gfr);
    } else if (key === DIABETES_T2) {
      continue; // ML 트랙에서 별도 처리
    }

    if (!result) {
      unsupported.push(disease);
      continue;
    }

    evaluated.push(disease);
    warnings.push(...result.warnings);
    worstRank = Math.max(worstRank, VERDICT_RANK[result.verdict]);
    for (const it of result.items || []) {
      const prev = evalByNutrient.get(it.nutrient);
      if (!prev || it.percent > prev.percent) {
        evalByNutrient.set(it.nutrient, { ...it, disease });
      }
    }
  }

  return {
    verdict: worstRank < 0 ? null : VERDICT_BY_RANK[worstRank],
    warnings,
    evaluated,
    unsupported,
    evaluations: Array.from(evalByNutrient.values()).sort((a, b) => b.percent - a.percent),
  };
}

/**
 * 질병 보유 사용자의 음식 적합성 판정
 *
 * 여러 질병 동시 보유 시:
 *   - 2형 당뇨 → ML(GI 예측) 판정, 나머지 질환 → 규칙 기반 판정
 *   - 각 판정을 독립적으로 수행한 뒤 warnings 를 합산하고 가장 보수적인 verdict 채택
 *
 * @param {object} session
 * @param {string} foodName
 * @param {string[]} diseases
 * @param {number} weight
 * @param {number} height
 * @param {number} age
 * @param {string} gender
 * @param {object} diseaseDetails - { hypertension_stage, ldl_value, tg_value, hdl_value, gfr_value }
 * @param {object} [deps] - 테스트용 주입 { getNutrition, callML }
 * @returns {Promise<null | object>} 음식이 없으면 null
 *   판정 가능한 질환이 하나도 없으면 { unsupported: true, unsupportedDiseases }
 */
async function scoreForDiseaseUser(
  session,
  foodName,
  diseases,
  weight,
  height,
  age,
  gender,
  diseaseDetails = {},
  deps = {},
) {
  const getNutrition = deps.getNutrition || getFoodNutrition;
  const callML = deps.callML || callMLService;

  const nutrition = await getNutrition(session, foodName);
  if (!nutrition) return null;

  const bmi = calcBMI(weight, height);
  const kdri = getDailyReference(gender, age);

  const hasType2 = diseases.some((d) => normalizeDiseaseName(d) === DIABETES_T2);
  const rules = evaluateRuleDiseases(nutrition, diseases, {
    weight,
    kdri,
    diseaseDetails,
  });

  if (!hasType2 && rules.verdict === null) {
    return { unsupported: true, unsupportedDiseases: rules.unsupported };
  }

  let giCategory = null;
  let worstRank = rules.verdict === null ? 0 : VERDICT_RANK[rules.verdict];
  const evaluatedDiseases = [...rules.evaluated];

  if (hasType2) {
    const mlResult = await callML(nutrition);
    giCategory = mlResult.gi_category; // "Low" | "Medium" | "High"
    worstRank = Math.max(worstRank, VERDICT_RANK[verdictFromGi(giCategory)]);
    evaluatedDiseases.unshift("2형 당뇨");
  }

  return {
    diseaseTrack: hasType2 ? "diabetes" : "rule",
    verdict: VERDICT_BY_RANK[worstRank],
    giCategory,
    warnings: rules.warnings,
    evaluations: rules.evaluations,
    nutrition,
    bmi: Number.isFinite(bmi) ? bmi.toFixed(1) : null,
    evaluatedDiseases,
    unsupportedDiseases: rules.unsupported,
  };
}

/**
 * 건강한 사용자 판정 함수
 * 현재 미구현 → recommend.js에서 차단 중
 * TODO: 추후 구현
 */
async function scoreForHealthyUser(
  session,
  foodName,
  weight,
  height,
  age,
  gender,
) {
  // TODO
}

module.exports = {
  scoreForDiseaseUser,
  scoreForHealthyUser,
  getDailyReference,
  // 테스트/내부 재사용용
  MlServiceError,
  callMLService,
  evaluateRuleDiseases,
  evaluateDyslipidemia,
  combineResults,
};
