/**
 * scoreService.js
 * - 역할: 음식 점수 계산
 * - 변경: 2형 당뇨 케이스에서 기존 threshold 로직 제거,
 *         Python ML 서비스(/predict) 호출로 교체
 */

const http = require("http");
const { getFoodNutrition, getLimitNutrients } = require("./foodService");

const BASE_THRESHOLDS = {
  당류: 15,
  나트륨: 500,
  탄수화물: 60,
  포화지방: 5,
  트랜스지방: 0.5,
  콜레스테롤: 100,
};

function calcBMI(weight, height) {
  const h = height / 100;
  return weight / (h * h);
}

function calcMultiplier(bmi, age) {
  let multiplier = 1.0;
  if (bmi >= 30) multiplier -= 0.3;
  else if (bmi >= 25) multiplier -= 0.2;
  else if (bmi >= 23) multiplier -= 0.1;
  if (age >= 65) multiplier -= 0.2;
  else if (age >= 50) multiplier -= 0.1;
  return Math.max(multiplier, 0.5);
}

// ML 서비스 호출 함수
// Python FastAPI(/predict)에 영양소 전달 → gi_category 반환
function callMLService(nutrition) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      calories: nutrition.calories,
      protein: nutrition.protein,
      fats: nutrition.fat,
      carbs: nutrition.carbohydrate,
      fiber: 0, // Neo4j에 아직 없는 영양소 → 0으로 대체
      sugar: nutrition.sugar,
      phosphorus: 0, // Neo4j에 아직 없는 영양소 → 0으로 대체
      potassium: 0, // Neo4j에 아직 없는 영양소 → 0으로 대체
      sodium: nutrition.sodium,
      saturated_fat: nutrition.saturatedFat,
      trans_fat: nutrition.transFat,
    });

    const options = {
      hostname: "ml", // docker-compose 서비스 이름
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

async function scoreForDiseaseUser(
  session,
  foodName,
  diseases,
  weight,
  height,
  age,
) {
  const warnings = [];
  let score = 100;

  const nutrition = await getFoodNutrition(session, foodName);
  if (!nutrition) return null;

  const bmi = calcBMI(weight, height);
  const multiplier = calcMultiplier(bmi, age);

  // 2형 당뇨인 경우 ML 서비스 호출
  if (diseases.includes("2형 당뇨")) {
    const mlResult = await callMLService(nutrition);
    const giCategory = mlResult.gi_category;

    if (giCategory === "High") {
      score -= 30;
      warnings.push("GI 지수 높음 (High) - 혈당 급상승 위험");
    } else if (giCategory === "Medium") {
      score -= 15;
      warnings.push("GI 지수 중간 (Medium) - 섭취 주의");
    }
  }

  // 2형 당뇨 외 다른 질환은 기존 규칙 로직 유지
  const otherDiseases = diseases.filter((d) => d !== "2형 당뇨");
  if (otherDiseases.length > 0) {
    const nutritionValueMap = {
      당류: nutrition.sugar,
      나트륨: nutrition.sodium,
      탄수화물: nutrition.carbohydrate,
      포화지방: nutrition.saturatedFat,
      트랜스지방: nutrition.transFat,
      콜레스테롤: nutrition.cholesterol,
    };

    const diseaseNutrients = await getLimitNutrients(session, otherDiseases);
    for (const { diseaseName, limitNutrients } of diseaseNutrients) {
      for (const nutrientName of limitNutrients) {
        const base = BASE_THRESHOLDS[nutrientName];
        const value = nutritionValueMap[nutrientName];
        if (base === undefined || value === undefined) continue;
        const adjustedThreshold = base * multiplier;
        if (value > adjustedThreshold) {
          const penalty = value > adjustedThreshold * 1.5 ? 20 : 10;
          score -= penalty;
          warnings.push(
            `${nutrientName} 과다 (${value}) - ${diseaseName} 환자 기준 초과`,
          );
        }
      }
    }
  }

  return {
    score: Math.max(0, score),
    warnings,
    nutrition,
    bmi: bmi.toFixed(1),
  };
}

async function scoreForHealthyUser(session, foodName, weight, height, age) {
  // 현재 사용 안 함 - recommend.js에서 차단 중
}

module.exports = { scoreForDiseaseUser, scoreForHealthyUser };
