// 2형당뇨만 구현
const { getFoodNutrition, getLimitNutrients } = require("./foodService");

/**
 * 기본 영양소 임계값 (1인분 기준)
 * - 이 값을 초과하면 "과다"로 판단
 * - 출처: 한국 식품의약품안전처 1일 영양성분 기준치 기반
 * - 단위: 당류/탄수화물/포화지방/트랜스지방/단백질 → g
 *         나트륨 → mg, 콜레스테롤 → mg
 */
const BASE_THRESHOLDS = {
  "당류":       15,   // 1일 권장량(100g) 중 1끼 기준 15g
  "나트륨":     500,  // 1일 권장량(2000mg) 중 1끼 기준 500mg
  "탄수화물":   60,   // 1일 권장량(324g) 중 1끼 기준 60g
  "포화지방":   5,    // 1일 권장량(15g) 중 1끼 기준 5g
  "트랜스지방": 0.5,  // WHO 권장 최대치(2.2g) 기준 엄격 적용
  "콜레스테롤": 100,  // 1일 권장량(300mg) 중 1끼 기준 100mg
};

/**
 * BMI 계산 함수
 * - 공식: 몸무게(kg) / 키(m)²
 * - 예: 몸무게 70kg, 키 170cm → 70 / (1.7 × 1.7) = 24.2
 * @param {number} weight - 몸무게 (kg)
 * @param {number} height - 키 (cm)
 * @returns {number} BMI 수치
 */

function calcBMI(weight, height) {
  const h = height / 100; // cm → m 변환
  return weight / (h * h);
}

/**
 * BMI + 나이 기반 임계값 배율 계산
 *
 * - 배율이 낮을수록 기준이 엄격해짐
 *   예: 배율 0.7이면 당류 임계값 15g → 10.5g으로 낮아짐
 *
 * - 한국 대한비만학회 기준 적용 (WHO 기준과 다름)
 *   WHO:  BMI 25 이상 = 과체중, BMI 30 이상 = 비만
 *   한국: BMI 23 이상 = 과체중, BMI 25 이상 = 비만
 *
 * - 나이가 많을수록 대사 능력 저하 → 기준 추가 강화
 *
 * @param {number} bmi - BMI 수치
 * @param {number} age - 나이
 * @returns {number} 배율 (0.5 ~ 1.0)
 */

function calcMultiplier(bmi, age) {
  let multiplier = 1.0;

  // BMI 기반 감소
  if (bmi >= 30)      multiplier -= 0.3;  // 비만: 기준 30% 강화
  else if (bmi >= 25) multiplier -= 0.2;  // 경도비만: 기준 20% 강화
  else if (bmi >= 23) multiplier -= 0.1;  // 과체중: 기준 10% 강화

  // 나이 기반 감소
  if (age >= 65)      multiplier -= 0.2;  // 노인: 기준 20% 추가 강화
  else if (age >= 50) multiplier -= 0.1;  // 중장년: 기준 10% 추가 강화

  // 최소 0.5 보장 (기준이 너무 엄격해지지 않도록 하한선 설정)
  return Math.max(multiplier, 0.5);
}

/**
 * 케이스 A: 이미 질병이 있는 사용자의 음식 점수 계산
 *
 * [동작 흐름]
 * 1. Neo4j에서 음식 영양소 조회
 * 2. BMI + 나이로 임계값 배율 계산 (건강 상태가 나쁠수록 기준 엄격)
 * 3. Neo4j SHOULD_LIMIT 관계로 질환별 제한 영양소 목록 조회
 *    예: 2형 당뇨 → [당류, 탄수화물, 포화지방]
 * 4. 제한 영양소별로 임계값 초과 여부 판단 → 점수 감점 + 경고 생성
 *
 * [점수 감점 기준]
 * - 임계값 초과: -10점
 * - 임계값의 1.5배 초과 (심각): -20점
 *
 * @param {object} session   - Neo4j 세션
 * @param {string} foodName  - 음식 이름 (Neo4j Food 노드의 name 속성)
 * @param {string[]} diseases - 사용자 질환 목록 예: ["2형 당뇨", "고혈압"]
 * @param {number} weight    - 몸무게 (kg)
 * @param {number} height    - 키 (cm)
 * @param {number} age       - 나이
 * @returns {object|null} { score, warnings, nutrition, bmi } 또는 음식 없으면 null
 */


async function scoreForDiseaseUser(session, foodName, diseases, weight, height, age) {
  const warnings = []; // 경고 메시지 목록
  let score = 100;     // 시작 점수 100점에서 감점

  // 1. Neo4j에서 음식 영양소 조회
  const nutrition = await getFoodNutrition(session, foodName);
  if (!nutrition) return null; // 음식을 찾지 못하면 null 반환

  // 2. BMI 계산 및 임계값 배율 산출
  const bmi        = calcBMI(weight, height);
  const multiplier = calcMultiplier(bmi, age);

  // 3. 영양소 이름(한글) → 실제 값 매핑
  //    Neo4j SHOULD_LIMIT에서 반환하는 영양소 이름과 키를 맞춰야 함
  const nutritionValueMap = {
    "당류":       nutrition.sugar,
    "나트륨":     nutrition.sodium,
    "탄수화물":   nutrition.carbohydrate,
    "포화지방":   nutrition.saturatedFat,
    "트랜스지방": nutrition.transFat,
    "콜레스테롤": nutrition.cholesterol,
  };

  // 4. Neo4j에서 질환별 제한 영양소 목록 조회
  //    예: 2형 당뇨 → 당류, 탄수화물 / 고혈압 → 나트륨, 포화지방
  const diseaseNutrients = await getLimitNutrients(session, diseases);

  // 5. 질환별 제한 영양소 순회하며 점수 계산
  for (const { diseaseName, limitNutrients } of diseaseNutrients) {
    for (const nutrientName of limitNutrients) {
      const base  = BASE_THRESHOLDS[nutrientName]; // 기본 임계값
      const value = nutritionValueMap[nutrientName]; // 음식의 실제 영양소 값

      // 매핑되지 않은 영양소는 건너뜀
      if (base === undefined || value === undefined) continue;

      // BMI/나이 배율 적용한 실제 임계값
      const adjustedThreshold = base * multiplier;

      if (value > adjustedThreshold) {
        // 임계값의 1.5배 초과: 심각 → 20점 감점
        // 임계값 초과: 경미 → 10점 감점
        const penalty = value > adjustedThreshold * 1.5 ? 20 : 10;
        score -= penalty;
        warnings.push(`${nutrientName} 과다 (${value}) - ${diseaseName} 환자 기준 초과`);
      }
    }
  }

  return {
    score:    Math.max(0, score), // 최소 0점 보장
    warnings,
    nutrition,
    bmi:      bmi.toFixed(1),     // 소수점 1자리까지 반환
  };
}

/**
 * 케이스 B: 질병이 없는 건강한 사용자의 음식 점수 계산
 *
 * [동작 흐름]
 * 1. Neo4j에서 음식 영양소 조회
 * 2. 로지스틱 회귀로 2형 당뇨 발생 위험도 계산
 * 3. 위험도에 따라 임계값 배율 조정 (위험할수록 기준 엄격)
 * 4. 당류/탄수화물/나트륨 초과 여부 판단 → 점수 감점
 *
 * [2형 당뇨 위험도 모델]
 * - 수식: logit(P) = β0 + β1·BMI + β2·Age + β3·(BMI × Age)
 * - 출처: FINDRISC 모델 (Lindström & Tuomilehto, Diabetes Care, 2003)
 * - 현재 β 계수는 문헌 근사값 사용 (실제 계수 확보 후 B0~B3만 교체)
 *   B0 = -6.0  (intercept: 기저 위험)
 *   B1 =  0.15 (BMI 1 증가 시 위험 증가량)
 *   B2 =  0.04 (나이 1 증가 시 위험 증가량)
 *   B3 =  0.002(BMI × 나이 교호작용: 고령+비만 조합 시 위험 증폭)
 *
 * [위험도 기준]
 * - 30% 이상: 고위험 → 임계값 30% 강화
 * - 15~30%:   중간위험 → 임계값 15% 강화
 * - 15% 미만: 저위험 → 기본 임계값 적용
 *
 * @param {object} session  - Neo4j 세션
 * @param {string} foodName - 음식 이름
 * @param {number} weight   - 몸무게 (kg)
 * @param {number} height   - 키 (cm)
 * @param {number} age      - 나이
 * @returns {object|null} { score, warnings, nutrition, bmi, t2dRisk } 또는 null
 */


async function scoreForHealthyUser(session, foodName, weight, height, age) {
  const warnings = [];
  let score = 100;

  // 1. Neo4j에서 음식 영양소 조회
  const nutrition = await getFoodNutrition(session, foodName);
  if (!nutrition) return null;

  const bmi = calcBMI(weight, height);

  // 2. 2형 당뇨 위험도 계산 (로지스틱 회귀)
  // ※ β 계수 확보 후 아래 B0~B3 값만 교체하면 됨
  const B0 = -6.0, B1 = 0.15, B2 = 0.04, B3 = 0.002;
  const logit   = B0 + B1 * bmi + B2 * age + B3 * bmi * age;
  const t2dRisk = 1 / (1 + Math.exp(-logit)); // 시그모이드 함수로 0~1 확률 변환



  // 3. 위험도에 따라 임계값 배율 결정
  let multiplier = 1.0;
  if (t2dRisk >= 0.3) {
    // 고위험: 기준 30% 강화
    multiplier = 0.7;
    warnings.push(`2형 당뇨 위험도 높음 (${(t2dRisk * 100).toFixed(1)}%)`);
  } else if (t2dRisk >= 0.15) {
    // 중간위험: 기준 15% 강화
    multiplier = 0.85;
    warnings.push(`2형 당뇨 위험도 중간 (${(t2dRisk * 100).toFixed(1)}%)`);
  }

  // 4. 당류/탄수화물/나트륨 초과 여부 판단
  //    건강한 사용자는 2형 당뇨 예방 관점에서 이 3가지를 주로 체크
  if (nutrition.sugar > BASE_THRESHOLDS["당류"] * multiplier) {
    score -= 15;
    warnings.push(`당류 ${nutrition.sugar}g 초과`);
  }
  if (nutrition.carbohydrate > BASE_THRESHOLDS["탄수화물"] * multiplier) {
    score -= 10;
    warnings.push(`탄수화물 ${nutrition.carbohydrate}g 초과`);
  }
  if (nutrition.sodium > BASE_THRESHOLDS["나트륨"] * multiplier) {
    score -= 10;
    warnings.push(`나트륨 ${nutrition.sodium}mg 초과`);
  }

  return {
    score:    Math.max(0, score),
    warnings,
    nutrition,
    bmi:      bmi.toFixed(1),
    t2dRisk:  (t2dRisk * 100).toFixed(1) + "%", // 퍼센트 문자열로 반환
  };
}

module.exports = { scoreForDiseaseUser, scoreForHealthyUser };
