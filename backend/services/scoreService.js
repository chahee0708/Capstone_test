/**
 * scoreService.js
 *
 * 역할: 사용자의 질병 종류 및 심각도에 따라 음식 적합성을 판정하는 서비스
 *
 * 판정 트랙:
 *   - 2형 당뇨      → Python ML 서비스 (GI Category 기반)
 *   - 고혈압        → 규칙 기반 (나트륨, Stage I/II)
 *   - 이상지질혈증  → 규칙 기반 (포화지방, 트랜스지방, 콜레스테롤, LDL 심각도별)
 *   - 1형 당뇨      → 규칙 기반 (당류만. 탄수화물은 STEP 5에서 판정 제외 → carbInfo로 정보 표시)
 *   - 신장병        → 규칙 기반 (나트륨, 단백질, GFR 단계별)
 *   - 갑상선        → 미구현 (요오드 데이터 없음, 완전 제외)
 *   - 무질환        → 규칙 기반 (KDRI 일반인 기준치, 나트륨/당류/포화지방/트랜스지방/지방)
 *
 * 판정 공식 근거: 영국 FoP 가이드라인 (UK DoH/FSA, 2016, Annex 3 Table 2, p.19)
 *   HIGH(비추천) = 질병별 1일 한도 × 25% / 100g 초과
 *   LOW(추천)   = 질병별 1일 한도 × 5.6% / 100g 이하 (FoP LOW 기준 평균값)
 *
 * 여러 질병 동시 보유 시: 각 질병별 독립 판정 후 가장 보수적 판정 채택
 *
 * ── 이번 변경(STEP 1 / STEP 5) 요약 ──────────────────────────
 * STEP 1 (판정 로직 변경 없음, 응답 데이터만 추가):
 *   - radar   : 방사형 그래프용 6축 데이터 (탄수화물/당류/나트륨/지방/포화지방/단백질)
 *   - reasons : "주의"/"비추천" 영양소의 판정 근거 (프론트에서 줄글로 출력)
 *   - getDisplayDailyReference : 화면 표시용 탄수화물 기준을 130g → 에너지×65%÷4 로 교체
 * STEP 5 (판정 로직 변경):
 *   - 1형 당뇨 판정에서 탄수화물 제외, carbInfo로 정보 표시만
 *
 * 호출하는 곳: backend/routes/recommend.js
 */

const http = require("http");
const { getFoodNutrition } = require("./foodService");
// 판정 근거 출처 문자열 모음 (backend/services/sources.js)
const SOURCES = require("./sources");

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
 * [STEP 1-3 추가] 화면 표시용 탄수화물 1일 기준(g) 계산
 *
 * 기존 문제:
 *   KDRI 테이블의 탄수화물 130g은 "권장섭취량(최소 이만큼은 먹어라)"인데
 *   화면에서는 "이 이상 먹지 마라"(상한)처럼 쓰이고 있었다.
 *
 * 변경:
 *   KDRI 2020 탄수화물 에너지적정비율 55~65%의 상한(65%)으로 계산한다.
 *   탄수화물 1g = 4kcal 이므로 → 에너지 × 0.65 ÷ 4
 *
 * ※ 표시 전용이다. 판정에 쓰는 값은 건드리지 않는다.
 *
 * @param {number} energy - KDRI 1일 에너지 (kcal)
 * @returns {number} 탄수화물 1일 기준 (g)
 */
function getCarbDisplayLimit(energy) {
  return (energy * 0.65) / 4;
}

/**
 * [STEP 1-3 추가] 프론트 화면에 내려보낼 dailyReference 생성
 *
 * KDRI 원본 테이블을 그대로 쓰지 않고 복사본을 만든 뒤 탄수화물만 교체한다.
 * (원본 KDRI 객체를 수정하면 모듈 전역 테이블이 오염되므로 반드시 복사)
 *
 * 호출하는 곳: backend/routes/recommend.js
 *
 * @param {string} gender
 * @param {number} age
 * @returns {object} 표시용 1일 기준값
 */
function getDisplayDailyReference(gender, age) {
  const kdri = getDailyReference(gender, age);
  return {
    ...kdri, // 원본 복사 (나트륨/당류/단백질/식이섬유/에너지는 그대로)
    탄수화물: round1(getCarbDisplayLimit(kdri.에너지)), // 130g → 에너지 기반 상한으로 교체
  };
}

/**
 * 소수 첫째 자리 반올림 (응답 숫자를 보기 좋게 만드는 용도)
 */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 영양소 이름 → 단위 문자열
 * 나트륨만 mg, 나머지는 g
 */
function getNutrientUnit(nutrientName) {
  return nutrientName === "나트륨" ? "mg" : "g";
}

/**
 * 영국 FoP 25%/5.6% 공식으로 임계값 계산
 * 근거: UK DoH/FSA FoP Guidance (2016), Annex 3 Table 2, p.19
 *
 * LOW 계수 5.6%는 같은 가이드라인 LOW 기준의 실제 비율
 * (지방 4.3%, 포화지방 7.5%, 당류 5.6%, 소금 5.0%)의 평균값이다.
 *
 * @param {number} dailyLimit - 질병별 1일 한도
 * @returns {{ high: number, low: number }}
 */
function calcThreshold(dailyLimit) {
  return {
    high: dailyLimit * 0.25, // 1일 한도의 25% 초과 → 비추천
    low: dailyLimit * 0.056, // 1일 한도의 5.6% 이하 → 추천 (FoP LOW 기준 평균값)
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
 * [STEP 1 변경] 판정 로직은 그대로 두고 반환값만 2개 추가했다.
 *   - reasons : 판정이 "주의"/"비추천"인 영양소의 근거 데이터 (줄글 출력용)
 *   - limits  : 판정 결과와 무관하게 이 질병이 정한 영양소별 1일 한도 (방사형 그래프용)
 *   기존 verdict / warnings 계산식은 한 줄도 바뀌지 않았다.
 *
 * @param {Array} evaluations
 *   [{ nutrientName, value, dailyLimit, disease, severityLabel, source }]
 *   disease / severityLabel / source는 근거 표시용이라 없어도 판정에는 영향이 없다.
 * @returns {{ verdict, warnings, reasons, limits }}
 */
function combineResults(evaluations) {
  const warnings = [];
  const reasons = []; // 판정 근거 줄글용
  const limits = []; // 방사형 그래프 축 기준용
  let worstRank = 0;

  for (const ev of evaluations) {
    const { nutrientName, value, dailyLimit } = ev;

    // 이 질병이 이 영양소에 건 1일 한도를 기록 (판정이 "추천"이어도 그래프 축 기준으로 필요)
    limits.push({
      nutrientName,
      dailyLimit,
      disease: ev.disease ?? null,
      severityLabel: ev.severityLabel ?? "",
      source: ev.source ?? "",
    });

    // 값이 없거나 0이면 스킵 (Neo4j에 없는 영양소)
    if (value === undefined || value === null) continue;

    const { level, percent } = evaluateNutrient(value, dailyLimit);

    if (level === "high") {
      warnings.push(`${nutrientName} 높음 (1일 기준 ${percent}%) — 비추천`);
    } else if (level === "mid") {
      warnings.push(`${nutrientName} 보통 (1일 기준 ${percent}%) — 주의`);
    }

    // "주의"(mid) 또는 "비추천"(high)일 때만 근거를 남긴다
    if (level !== "low") {
      const threshold = calcThreshold(dailyLimit);
      reasons.push({
        disease: ev.disease ?? null,
        severityLabel: ev.severityLabel ?? "",
        nutrient: nutrientName,
        amountPer100g: round1(value),
        unit: getNutrientUnit(nutrientName),
        // 비추천은 HIGH 기준선(25%), 주의는 LOW 기준선(5.6%)을 넘은 것이므로
        // 실제로 넘어선 쪽 기준값을 근거로 내려준다
        thresholdPer100g: round1(
          level === "high" ? threshold.high : threshold.low,
        ),
        dailyLimit: round1(dailyLimit),
        verdict: level === "high" ? "비추천" : "주의",
        source: ev.source ?? "",
      });
    }

    worstRank = Math.max(worstRank, LEVEL_RANK[level]);
  }

  const verdict =
    worstRank === 2 ? "비추천" : worstRank === 1 ? "주의" : "추천";

  return { verdict, warnings, reasons, limits };
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
      // ↓ 근거 표시용 메타데이터 (판정에는 영향 없음)
      disease: "고혈압",
      // 이 한도를 실제로 결정한 조건을 그대로 라벨로 쓴다
      severityLabel: stage === 2 ? "Stage II" : "Stage I",
      source:
        stage === 2 ? SOURCES.HYPERTENSION_STAGE2 : SOURCES.HYPERTENSION_STAGE1,
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
  // LDL: 0=정상(<130), 1=경계(130~159), 2=높음(160~189), 3=매우높음(≥190)
  const ldlSev =
    ldlValue >= 190 ? 3 :
    ldlValue >= 160 ? 2 :
    ldlValue >= 130 ? 1 : 0;

  // TG: 0=정상(<150), 1=경계(150~199), 2=높음(200~499), 3=매우높음(≥500)
  const tgSev =
    tgValue >= 500 ? 3 :
    tgValue >= 200 ? 2 :
    tgValue >= 150 ? 1 : 0;

  // HDL: 0=정상(≥40), 1=낮음(<40)
  const hdlLow = hdlValue < 40 ? 1 : 0;

  const nutrients = [];

  // 근거 표시용 공통 값 (판정에는 영향 없음)
  const DIS = "이상지질혈증";
  const SRC = SOURCES.DYSLIPIDEMIA;

  // 포화지방
  // severityLabel에는 "이 한도를 실제로 결정한 조건"을 적는다.
  // (분기 조건 자체를 그대로 문장으로 옮긴 것)
  if (tgSev >= 2) {
    nutrients.push({ nutrientName: "포화지방", value: nutrition.saturatedFat, dailyLimit: (energy * 0.05) / 9,
      disease: DIS, severityLabel: "중성지방 200 이상", source: SRC });
  } else if (ldlSev >= 1 || tgSev === 1) {
    // 두 조건이 동시에 참이면 LDL을 우선 표기 (분기에서 먼저 평가되는 쪽)
    nutrients.push({ nutrientName: "포화지방", value: nutrition.saturatedFat, dailyLimit: (energy * 0.07) / 9,
      disease: DIS, severityLabel: ldlSev >= 1 ? "LDL 130 이상" : "중성지방 150 이상", source: SRC });
  }

  // 트랜스지방 (항상 판정)
  nutrients.push({ nutrientName: "트랜스지방", value: nutrition.transFat, dailyLimit: (energy * 0.01) / 9,
    // 트랜스지방은 심각도와 무관하게 항상 같은 기준이라 severityLabel을 비워둔다
    disease: DIS, severityLabel: "", source: SOURCES.TRANS_FAT });

  // 탄수화물
  if (tgSev === 3) {
    nutrients.push({ nutrientName: "탄수화물", value: nutrition.carbohydrate, dailyLimit: (energy * 0.50) / 4,
      disease: DIS, severityLabel: "중성지방 500 이상", source: SRC });
  } else if (tgSev === 2) {
    nutrients.push({ nutrientName: "탄수화물", value: nutrition.carbohydrate, dailyLimit: (energy * 0.55) / 4,
      disease: DIS, severityLabel: "중성지방 200 이상", source: SRC });
  } else if (tgSev === 1) {
    nutrients.push({ nutrientName: "탄수화물", value: nutrition.carbohydrate, dailyLimit: (energy * 0.60) / 4,
      disease: DIS, severityLabel: "중성지방 150 이상", source: SRC });
  } else if (hdlLow === 1) {
    nutrients.push({ nutrientName: "탄수화물", value: nutrition.carbohydrate, dailyLimit: (energy * 0.65) / 4,
      disease: DIS, severityLabel: "HDL 40 미만", source: SRC });
  }

  // 당류
  if (tgSev === 3) {
    nutrients.push({ nutrientName: "당류", value: nutrition.sugar, dailyLimit: (energy * 0.05) / 4,
      disease: DIS, severityLabel: "중성지방 500 이상", source: SRC });
  } else if (tgSev >= 1) {
    nutrients.push({ nutrientName: "당류", value: nutrition.sugar, dailyLimit: (energy * 0.10) / 4,
      disease: DIS, severityLabel: "중성지방 150 이상", source: SRC });
  }

  return combineResults(nutrients);
}

/**
 * 1형 당뇨 판정
 *
 * 근거:
 *   - 당류: ADA Standards 2024, Section 5, p.S77 (에너지 10% 미만)
 *   - 심각도 구분 없음: ADA 검토 결과 HbA1c와 무관하게 동일 기준 적용
 *
 * [STEP 5 변경] 탄수화물을 판정에서 제외했다.
 *   기존에는 KDRI 탄수화물 130g/일을 상한처럼 써서
 *   100g당 32.5g(130 × 25%)을 넘으면 비추천 처리했다.
 *   그런데 130g은 "최소 이만큼은 먹어야 한다"는 권장섭취량이라
 *   상한으로 쓰면 방향이 정반대가 된다.
 *   대신 탄수화물 양은 carbInfo로 화면에 정보만 표시한다.
 *
 * @param {object} nutrition
 * @param {number} energy - KDRI 1일 에너지 (kcal)
 * @param {object} kdri   - KDRI 1일 기준값 객체 (탄수화물 판정 제외 후 미사용)
 */
function evaluateType1Diabetes(nutrition, energy, kdri) {
  // 당류: 1일 섭취열량의 10% → g 변환 (당류 1g = 4kcal)
  const sugarLimit = (energy * 0.1) / 4;

  return combineResults([
    {
      nutrientName: "당류",
      value: nutrition.sugar,
      dailyLimit: sugarLimit,
      disease: "1형 당뇨",
      severityLabel: "", // 1형 당뇨는 심각도 구분 없음
      source: SOURCES.TYPE1_SUGAR,
    },
    // [STEP 5] 탄수화물 판정 제외 — 코드는 남겨두고 주석 처리한다
    // ADA Standards of Care 2024 Sec.5: 고정 탄수화물 비율 권고 없음.
    // 개인화 및 인슐린 용량용 탄수화물 계산 교육 권고 → 판정 제외, 정보 표시로 전환
    // {
    //   nutrientName: "탄수화물",
    //   value: nutrition.carbohydrate,
    //   dailyLimit: kdri.탄수화물,
    // },
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

  // GFR 단계를 사람이 읽을 수 있는 라벨로 (단백질 한도를 결정한 조건)
  const gfrLabel =
    gfr === 0 ? "이식 환자" : gfr < 20 ? "GFR 20 미만" : "GFR 20~50";

  return combineResults([
    {
      nutrientName: "나트륨",
      value: nutrition.sodium,
      dailyLimit: sodiumLimit,
      disease: "신장병",
      severityLabel: "", // 나트륨 3000mg은 GFR 단계와 무관하게 동일
      source: SOURCES.CKD_SODIUM,
    },
    {
      nutrientName: "단백질",
      value: nutrition.protein,
      dailyLimit: proteinLimit,
      disease: "신장병",
      severityLabel: gfrLabel,
      source: SOURCES.CKD_PROTEIN,
    },
    // { nutrientName: "인",   value: nutrition.phosphorus, dailyLimit: 900 }, // TODO
    // { nutrientName: "칼륨", value: nutrition.potassium,  dailyLimit: 2000 }, // TODO
  ]);
}

// ─────────────────────────────────────────────────────────────
// 무질환(건강한 사용자) 판정 함수
// ─────────────────────────────────────────────────────────────

/**
 * 건강한 사용자(무질환) 판정
 *
 * 질병 트랙과 동일한 영국 FoP 25%/5.6% 공식을 사용하고,
 * 1일 한도 자리에만 질병별 한도 대신 일반인 기준치를 넣는다.
 *
 * 근거:
 *   - 나트륨, 당류: KDRI 2020 (한국인 영양소 섭취기준, 한국영양학회)
 *   - 포화지방: KDRI 2020 — 1일 섭취열량의 7% 미만 (지방 1g = 9kcal)
 *   - 트랜스지방: WHO 2023 (Global trans-fat elimination) — 1일 섭취열량의 1% 미만
 *   - 지방(총지방): KDRI 2020 에너지적정비율 상한 30%
 *
 * 영양소 값이 null/undefined면 combineResults에서 자동으로 판정 제외된다.
 *
 * @param {object} nutrition - 100g당 영양성분
 * @param {number} energy    - KDRI 1일 에너지 (kcal)
 * @param {object} kdri      - KDRI 1일 기준값 객체
 */
function evaluateHealthy(nutrition, energy, kdri) {
  // disease를 null로 두면 프론트가 "일반 성인 기준"으로 문장을 만든다
  // (질병명이 없는 사용자라 "○○이 있는 분께" 라는 문장을 쓸 수 없기 때문)
  return combineResults([
    { nutrientName: "나트륨", value: nutrition.sodium, dailyLimit: kdri.나트륨,
      disease: null, severityLabel: "", source: SOURCES.KDRI },
    { nutrientName: "당류", value: nutrition.sugar, dailyLimit: kdri.당류,
      disease: null, severityLabel: "", source: SOURCES.KDRI },
    {
      nutrientName: "포화지방",
      value: nutrition.saturatedFat,
      dailyLimit: (energy * 0.07) / 9,
      disease: null, severityLabel: "", source: SOURCES.KDRI,
    },
    {
      nutrientName: "트랜스지방",
      value: nutrition.transFat,
      dailyLimit: (energy * 0.01) / 9,
      disease: null, severityLabel: "", source: SOURCES.TRANS_FAT,
    },
    { nutrientName: "지방", value: nutrition.fat, dailyLimit: (energy * 0.30) / 9,
      disease: null, severityLabel: "", source: SOURCES.KDRI },
  ]);
}

// ─────────────────────────────────────────────────────────────
// [STEP 1-1] 방사형 그래프(radar) 데이터 생성
// ─────────────────────────────────────────────────────────────

// 방사형 그래프 6개 축 — 순서 고정 (프론트 NutrientRadarChart.tsx와 동일해야 함)
const RADAR_AXES = ["탄수화물", "당류", "나트륨", "지방", "포화지방", "단백질"];

// 축 이름 → nutrition 객체의 실제 키 이름 매핑
const RADAR_NUTRITION_KEY = {
  탄수화물: "carbohydrate",
  당류: "sugar",
  나트륨: "sodium",
  지방: "fat",
  포화지방: "saturatedFat",
  단백질: "protein",
};

/**
 * 질병 기준이 없는 축에 쓸 KDRI 기준값 계산
 *
 * KDRI 테이블에 지방/포화지방 항목이 없어서,
 * 이미 evaluateHealthy가 쓰고 있는 것과 똑같은 식을 재사용한다. (새 계산이 아님)
 *
 * @param {string} axis   - 축 이름
 * @param {object} kdri   - KDRI 1일 기준값 객체
 * @param {number} energy - KDRI 1일 에너지 (kcal)
 * @returns {number} 1일 기준값
 */
function getKdriAxisLimit(axis, kdri, energy) {
  if (axis === "탄수화물") return getCarbDisplayLimit(energy); // 에너지 × 65% ÷ 4
  if (axis === "당류") return kdri.당류;
  if (axis === "나트륨") return kdri.나트륨;
  if (axis === "지방") return (energy * 0.3) / 9; // evaluateHealthy와 동일
  if (axis === "포화지방") return (energy * 0.07) / 9; // evaluateHealthy와 동일
  if (axis === "단백질") return kdri.단백질;
  return null;
}

/**
 * 방사형 그래프용 6축 데이터 생성
 *
 * 축마다 기준(100%)을 정하는 규칙:
 *   1. 이 영양소를 제한하는 질병이 있으면 → 그 질병의 1일 한도 (basis: "disease")
 *   2. 여러 질병이 같은 영양소를 제한하면 → 가장 낮은(엄격한) 한도
 *   3. 제한하는 질병이 없으면 → KDRI 값 (basis: "kdri")
 *
 * @param {object} nutrition     - 100g당 영양성분
 * @param {Array}  diseaseLimits - combineResults가 모아준 질병별 한도 목록
 * @param {object} kdri          - KDRI 1일 기준값 객체
 * @param {number} energy        - KDRI 1일 에너지 (kcal)
 * @returns {Array} radar 배열
 */
function buildRadar(nutrition, diseaseLimits, kdri, energy) {
  // 같은 영양소가 여러 번 들어오면 가장 낮은 한도만 남긴다
  const lowest = {};
  for (const l of diseaseLimits) {
    if (!RADAR_AXES.includes(l.nutrientName)) continue; // 6축에 없는 영양소(트랜스지방 등)는 제외
    const prev = lowest[l.nutrientName];
    if (!prev || l.dailyLimit < prev.dailyLimit) lowest[l.nutrientName] = l;
  }

  return RADAR_AXES.map((axis) => {
    const picked = lowest[axis]; // 질병 기준이 있으면 그 객체, 없으면 undefined
    const dailyLimit = picked
      ? picked.dailyLimit
      : getKdriAxisLimit(axis, kdri, energy);
    const amount = nutrition[RADAR_NUTRITION_KEY[axis]] ?? 0;

    return {
      nutrient: axis,
      amountPer100g: round1(amount),
      unit: getNutrientUnit(axis),
      dailyLimit: round1(dailyLimit),
      // 100g을 먹었을 때 1일 한도의 몇 %인지
      percent: round1((amount / dailyLimit) * 100),
      basis: picked ? "disease" : "kdri",
      basisLabel: picked
        ? picked.severityLabel
          ? `${picked.disease}(${picked.severityLabel})`
          : picked.disease
        : "한국인 영양소 섭취기준",
    };
  });
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

    // ML 트랙은 영양소 한도를 쓰지 않으므로 방사형 축은 전부 KDRI 기준이다
    const radar = buildRadar(nutrition, [], kdri, kdri.에너지);

    // 판정이 "주의"/"비추천"일 때만 근거를 남긴다 (규칙 트랙과 동일한 원칙)
    const reasons =
      verdict === "추천"
        ? []
        : [
            {
              disease: "2형 당뇨",
              track: "ml", // 프론트가 ML 전용 문장을 쓰도록 구분하는 표시
              giCategory,
              verdict,
              source: SOURCES.ML_GI,
            },
          ];

    return {
      diseaseTrack: "diabetes",
      verdict,
      giCategory,
      warnings: [],
      reasons,
      radar,
      carbInfo: null, // 1형 당뇨 전용 필드 (2형 트랙에서는 항상 null)
      nutrition,
      bmi: bmi.toFixed(1),
    };
  }

  // ── 트랙 2: 규칙 기반 질병들 ─────────────────────────────────
  // 각 질병별로 독립 판정 후 결과 합산
  const allWarnings = [];
  const allReasons = []; // 판정 근거 줄글용 (질병별 결과를 모두 합침)
  const allLimits = []; // 방사형 그래프 축 기준용
  let worstRank = 0;

  for (const disease of diseases) {
    let result = null;

    if (disease === "고혈압") {
      const stage = diseaseDetails.hypertension_stage || 1;
      result = evaluateHypertension(nutrition, stage);
    } else if (disease === "이상지질혈증") {
      result = evaluateDyslipidemia(
        nutrition,
        kdri.에너지,
        diseaseDetails.ldl_value,
        diseaseDetails.tg_value,
        diseaseDetails.hdl_value,
      );
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
      allReasons.push(...result.reasons);
      allLimits.push(...result.limits);
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

  // [STEP 5-2] 1형 당뇨 사용자에게는 탄수화물 양을 정보로만 내려보낸다
  // (판정에서는 빠졌지만 인슐린 용량 계산에 필요한 값이라 화면에 표시)
  const carbInfo = diseases.includes("1형 당뇨")
    ? {
        amountPer100g: round1(nutrition.carbohydrate),
        unit: "g",
        source: SOURCES.TYPE1_CARB_INFO,
      }
    : null;

  return {
    diseaseTrack: "rule",
    verdict,
    giCategory: null,
    warnings: allWarnings,
    reasons: allReasons,
    radar: buildRadar(nutrition, allLimits, kdri, kdri.에너지),
    carbInfo,
    nutrition,
    bmi: bmi.toFixed(1),
  };
}

/**
 * 건강한 사용자(무질환)의 음식 적합성 판정
 *
 * 반환 객체의 키 구성은 scoreForDiseaseUser와 동일하게 맞춘다.
 * (ML 트랙이 아니므로 giCategory는 항상 null)
 *
 * @param {object} session
 * @param {string} foodName
 * @param {number} weight
 * @param {number} height
 * @param {number} age
 * @param {string} gender
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
  const kdri = getDailyReference(gender, age);

  const result = evaluateHealthy(nutrition, kdri.에너지, kdri);

  return {
    diseaseTrack: "healthy",
    verdict: result.verdict,
    giCategory: null,
    warnings: result.warnings,
    reasons: result.reasons,
    // 질병이 없는 사용자이므로 6축 모두 KDRI 기준을 쓴다 (빈 배열 전달)
    radar: buildRadar(nutrition, [], kdri, kdri.에너지),
    carbInfo: null,
    nutrition,
    bmi: bmi.toFixed(1),
  };
}

module.exports = {
  scoreForDiseaseUser,
  scoreForHealthyUser,
  evaluateHealthy,
  getDailyReference,
  // [STEP 1-3] 표시용 dailyReference (탄수화물만 에너지 기반 상한으로 교체됨)
  getDisplayDailyReference,
};
