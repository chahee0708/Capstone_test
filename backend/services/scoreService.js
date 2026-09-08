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
 *   - 질병 없음     → 규칙 기반 (KDRI/WHO 일반인 기준 + BMI 보정)
 *
 * 판정 공식 근거: 영국 FoP 가이드라인 (UK DoH/FSA, 2016, Annex 3 Table 2, p.19)
 *   HIGH(비추천) = 질병별 1일 한도 × 25% / 100g 초과
 *   LOW(추천)   = 질병별 1일 한도 × ~5% / 100g 이하 (EU 1924/2006 근사값)
 *
 * 여러 질병 동시 보유 시: 각 질병별 독립 판정 후 가장 보수적 판정 채택
 */

const http = require("http");
const { getFoodNutrition } = require("./foodService");

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

/**
 * 영양소 평가 목록을 종합해서 최종 verdict 반환
 * 가장 나쁜 영양소 기준으로 최종 판정 (보수적 판정 원칙)
 *
 * @param {Array} evaluations - [{ nutrientName, value, dailyLimit }]
 * @returns {{ verdict, warnings }}
 */
function combineResults(evaluations) {
  const warnings = [];
  let worstRank = 0;

  for (const { nutrientName, value, dailyLimit } of evaluations) {
    // 값이 없거나 0이면 스킵 (Neo4j에 없는 영양소)
    if (value === undefined || value === null) continue;

    const { level, percent } = evaluateNutrient(value, dailyLimit);

    if (level === "high") {
      warnings.push(`${nutrientName} 높음 (1일 기준 ${percent}%) — 비추천`);
    } else if (level === "mid") {
      warnings.push(`${nutrientName} 보통 (1일 기준 ${percent}%) — 주의`);
    }

    worstRank = Math.max(worstRank, LEVEL_RANK[level]);
  }

  const verdict =
    worstRank === 2 ? "비추천" : worstRank === 1 ? "주의" : "추천";

  return { verdict, warnings };
}

function calcBMI(weight, height) {
  const h = height / 100;
  return weight / (h * h);
}

// ─────────────────────────────────────────────────────────────
// ML 서비스 호출 (2형 당뇨 전용)
// ─────────────────────────────────────────────────────────────
function callMLService(nutrition) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      calories: nutrition.calories,
      protein: nutrition.protein,
      fats: nutrition.fat,
      carbs: nutrition.carbohydrate,
      fiber: 0, // TODO: Neo4j 스키마 확장 후 교체
      sugar: nutrition.sugar,
      phosphorus: 0, // TODO: Neo4j 스키마 확장 후 교체
      potassium: 0, // TODO: Neo4j 스키마 확장 후 교체
      sodium: nutrition.sodium,
      saturated_fat: nutrition.saturatedFat,
      trans_fat: nutrition.transFat,
    });

    const options = {
      hostname: "ml",
      port: 8000,
      path: "/predict",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve(JSON.parse(data));
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
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
 * 근거:
 *   - 포화지방: Grundy SM et al., Circulation 2019 (ACC/AHA 2018), Section 5, p.e289
 *     경계(borderline): 에너지 10% (WHO 2023)
 *     높음(high):       에너지 7%
 *     매우높음(very_high): 에너지 5%
 *   - 트랜스지방: WHO 2023, Chapter 4 (에너지 1% 미만)
 *   - 콜레스테롤: ACC/AHA 2018 + 한국지질동맥경화학회 2022
 *     경계: 300mg/일, 높음/매우높음: 200mg/일
 *
 * TODO: 식이섬유 — Neo4j 데이터 보강 후 추가
 *
 * @param {object} nutrition
 * @param {number} energy - KDRI 1일 에너지 (kcal)
 * @param {string} ldlLevel - 'borderline' | 'high' | 'very_high'
 */
function evaluateDyslipidemia(nutrition, energy, ldlLevel) {
  // 포화지방 에너지 비율 결정
  const satFatPct =
    ldlLevel === "borderline" ? 0.1 : ldlLevel === "high" ? 0.07 : 0.05; // very_high

  // 에너지 비율 → g/일 변환 (지방 1g = 9kcal)
  const satFatLimit = (energy * satFatPct) / 9;
  const transFatLimit = (energy * 0.01) / 9; // WHO: 에너지 1% 미만

  // 콜레스테롤 한도
  const cholLimit = ldlLevel === "borderline" ? 300 : 200;

  return combineResults([
    {
      nutrientName: "포화지방",
      value: nutrition.saturatedFat,
      dailyLimit: satFatLimit,
    },
    {
      nutrientName: "트랜스지방",
      value: nutrition.transFat,
      dailyLimit: transFatLimit,
    },
    {
      nutrientName: "콜레스테롤",
      value: nutrition.cholesterol,
      dailyLimit: cholLimit,
    },
    // { nutrientName: "식이섬유", value: nutrition.fiber, dailyLimit: 25 }, // TODO
  ]);
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
 * 질병 보유 사용자의 음식 적합성 판정
 *
 * 여러 질병 동시 보유 시:
 *   각 질병별로 독립 판정 → warnings 합산 → 가장 나쁜 verdict 채택
 *
 * @param {object} session
 * @param {string} foodName
 * @param {string[]} diseases
 * @param {number} weight
 * @param {number} height
 * @param {number} age
 * @param {string} gender
 * @param {object} diseaseDetails - { hypertension_stage, ldl_level, gfr_value }
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
) {
  const nutrition = await getFoodNutrition(session, foodName);
  if (!nutrition) return null;

  const bmi = calcBMI(weight, height);
  const kdri = getDailyReference(gender, age);

  // ── 트랙 1: 2형 당뇨 → ML 기반 판정 ────────────────────────
  if (diseases.includes("2형 당뇨")) {
    const mlResult = await callMLService(nutrition);
    const giCategory = mlResult.gi_category; // "Low" | "Medium" | "High"

    let verdict;
    if (giCategory === "High") verdict = "비추천";
    else if (giCategory === "Medium") verdict = "주의";
    else verdict = "추천";

    return {
      diseaseTrack: "diabetes",
      verdict,
      giCategory,
      warnings: [],
      nutrition,
      bmi: bmi.toFixed(1),
    };
  }

  // ── 트랙 2: 규칙 기반 질병들 ─────────────────────────────────
  // 각 질병별로 독립 판정 후 결과 합산
  const allWarnings = [];
  let worstRank = 0;

  for (const disease of diseases) {
    let result = null;

    if (disease === "고혈압") {
      const stage = diseaseDetails.hypertension_stage || 1;
      result = evaluateHypertension(nutrition, stage);
    } else if (disease === "이상지질혈증") {
      const ldlLevel = diseaseDetails.ldl_level || "high";
      result = evaluateDyslipidemia(nutrition, kdri.에너지, ldlLevel);
    } else if (disease === "1형 당뇨") {
      result = evaluateType1Diabetes(nutrition, kdri.에너지, kdri);
    } else if (disease === "신장병") {
      const gfr =
        diseaseDetails.gfr_value !== undefined ? diseaseDetails.gfr_value : 35;
      result = evaluateCKD(nutrition, weight, gfr);
    }
    // 갑상선: 완전 제외 (요오드 데이터 없음)

    if (result) {
      allWarnings.push(...result.warnings);
      worstRank = Math.max(
        worstRank,
        LEVEL_RANK[
          result.verdict === "비추천"
            ? "high"
            : result.verdict === "주의"
              ? "mid"
              : "low"
        ],
      );
    }
  }

  const verdict =
    worstRank === 2 ? "비추천" : worstRank === 1 ? "주의" : "추천";

  return {
    diseaseTrack: "rule",
    verdict,
    giCategory: null,
    warnings: allWarnings,
    nutrition,
    bmi: bmi.toFixed(1),
  };
}

// ─────────────────────────────────────────────────────────────
// 건강한 사용자(질병 없음) 판정 로직
// ─────────────────────────────────────────────────────────────

/**
 * BMI 단계 구분 (대한비만학회 2022 진료지침, 아시아-태평양 기준)
 *   저체중 < 18.5 / 정상 18.5~22.9 / 과체중 23~24.9 / 비만 >= 25
 */
function getBMICategory(bmi) {
  if (bmi < 18.5) return "저체중";
  if (bmi < 23) return "정상";
  if (bmi < 25) return "과체중";
  return "비만";
}

/**
 * BMI 단계별 에너지·당류 한도 보정 계수
 *
 * 근거: KDRI 2020 에너지필요추정량(EER)은 정상 체중 기준으로 산출되므로,
 *       체중 조절이 필요한 구간에서는 한도를 낮춰 더 보수적으로 판정한다.
 *   비만   → 0.8 (에너지 섭취 감량 필요)
 *   과체중 → 0.9
 *   정상   → 1.0
 *   저체중 → 1.1 (에너지 섭취 여유)
 */
function getBMIFactor(bmiCategory) {
  if (bmiCategory === "비만") return 0.8;
  if (bmiCategory === "과체중") return 0.9;
  if (bmiCategory === "저체중") return 1.1;
  return 1.0;
}

/**
 * 건강한 사용자용 1일 한도 계산
 *
 * 근거:
 *   - 에너지:     KDRI 2020 에너지필요추정량(EER) × BMI 보정
 *   - 당류:       WHO Guideline on sugars intake (2015) — 총 에너지의 10% 미만
 *                 (당류 1g = 4kcal) × BMI 보정
 *   - 나트륨:     KDRI 2020 만성질환위험감소섭취량 (성인 2300mg/일)
 *   - 포화지방:   KDRI 2020 에너지적정비율 — 총 에너지의 7% 미만 (지방 1g = 9kcal)
 *   - 트랜스지방: WHO 2023 — 총 에너지의 1% 미만
 *   - 콜레스테롤: KDRI 2020 — 300mg/일 미만
 *
 * @param {object} kdri        - getDailyReference() 결과
 * @param {number} bmiFactor   - BMI 보정 계수
 */
function getHealthyLimits(kdri, bmiFactor) {
  const energy = kdri.에너지 * bmiFactor;

  return {
    에너지: energy,
    당류: (energy * 0.1) / 4,
    나트륨: kdri.나트륨,
    포화지방: (energy * 0.07) / 9,
    트랜스지방: (energy * 0.01) / 9,
    콜레스테롤: 300,
  };
}

/**
 * 긍정 영양소 안내 문구 생성
 * 판정(verdict)에는 영향을 주지 않고 참고 정보로만 사용한다.
 *
 * 기준: EU 1924/2006 — 1일 기준치의 15% 이상이면 "공급원(source of)"
 */
function getHealthyHighlights(nutrition, kdri, limits) {
  const highlights = [];

  const proteinPercent = Math.round((nutrition.protein / kdri.단백질) * 100);
  if (proteinPercent >= 15) {
    highlights.push(`단백질 공급원 (1일 기준 ${proteinPercent}%)`);
  }

  const sodiumPercent = Math.round((nutrition.sodium / limits.나트륨) * 100);
  if (sodiumPercent <= 5) {
    highlights.push(`나트륨 낮음 (1일 기준 ${sodiumPercent}%)`);
  }

  const sugarPercent = Math.round((nutrition.sugar / limits.당류) * 100);
  if (sugarPercent <= 5) {
    highlights.push(`당류 낮음 (1일 기준 ${sugarPercent}%)`);
  }

  return highlights;
}

/**
 * 건강한 사용자(질병 없음)의 음식 적합성 판정
 *
 * 질병 트랙과 동일하게 영국 FoP 25%/5% 공식(calcThreshold)을 사용하되,
 * 한도를 질병 기준이 아닌 일반인 기준(KDRI + WHO)으로 잡는다.
 *   HIGH(비추천) = 1일 한도의 25% 초과 / 100g
 *   MID(주의)    = 1일 한도의 5% 초과 / 100g
 *   LOW(추천)    = 1일 한도의 5% 이하 / 100g
 *
 * @param {object} session
 * @param {string} foodName
 * @param {number} weight  - 체중 (kg)
 * @param {number} height  - 키 (cm)
 * @param {number} age
 * @param {string} gender
 * @returns {object|null} 음식이 없으면 null
 */
async function scoreForHealthyUser(
  session,
  foodName,
  weight,
  height,
  age,
  gender,
) {
  const nutrition = await getFoodNutrition(session, foodName);
  if (!nutrition) return null;

  const bmi = calcBMI(weight, height);
  const bmiCategory = getBMICategory(bmi);
  const bmiFactor = getBMIFactor(bmiCategory);

  const kdri = getDailyReference(gender, age);
  const limits = getHealthyLimits(kdri, bmiFactor);

  // ── 영양소별 평가 → 가장 나쁜 등급으로 최종 판정 ──────────
  const { verdict, warnings } = combineResults([
    { nutrientName: "열량", value: nutrition.calories, dailyLimit: limits.에너지 },
    { nutrientName: "당류", value: nutrition.sugar, dailyLimit: limits.당류 },
    { nutrientName: "나트륨", value: nutrition.sodium, dailyLimit: limits.나트륨 },
    {
      nutrientName: "포화지방",
      value: nutrition.saturatedFat,
      dailyLimit: limits.포화지방,
    },
    {
      nutrientName: "트랜스지방",
      value: nutrition.transFat,
      dailyLimit: limits.트랜스지방,
    },
    {
      nutrientName: "콜레스테롤",
      value: nutrition.cholesterol,
      dailyLimit: limits.콜레스테롤,
    },
  ]);

  return {
    diseaseTrack: "healthy",
    verdict, // "추천" | "주의" | "비추천"
    giCategory: null, // 건강한 사용자는 ML(GI) 트랙을 쓰지 않음
    warnings,
    highlights: getHealthyHighlights(nutrition, kdri, limits), // 긍정 영양소 안내
    nutrition,
    bmi: bmi.toFixed(1),
    bmiCategory, // "저체중" | "정상" | "과체중" | "비만"
  };
}

module.exports = {
  scoreForDiseaseUser,
  scoreForHealthyUser,
  getDailyReference,
};
