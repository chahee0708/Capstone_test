/**
 * mlFeatures.js
 *
 * 역할: 2형 당뇨 ML(GI 예측) 입력 11개 중 식이섬유·인·칼륨 채우기
 *   1) 식품에 값이 있으면 그 값 (Neo4j Food.fiber 또는 dietary_fiber, potassium, phosphorus)
 *   2) 없으면 같은 통합 중분류(unified_mid) 평균
 *   3) 중분류를 모르거나 그 중분류에 값이 하나도 없으면 전체 식품 평균
 *   사진(OCR) 결과는 라벨에 칼륨·인이 없으므로 labelCategory 로 정한 중분류 평균을 쓴다
 *
 * 왜 필요한가 (새 파일):
 *   예전에는 세 값을 항상 0 으로 보냈다 (scoreService.callMLService 의 TODO).
 *   모델은 이 세 값이 실제로 들어간 데이터로 학습했고(중요도 합 약 29%), 0 은 학습 데이터 평균
 *   (섬유 3.2g·인 108mg·칼륨 234mg)보다 한참 낮아 예측이 "Low" 로 쏠렸다.
 *   중분류별 표본 2,161개 비교: High 예측 0% → 4% (라면 0→33%, 식빵 0→43%, 피자·버거 0→30%)
 *   Neo4j 식품 98,592개 중 약 98% 가 이미 칼륨·인·식이섬유 값을 가지고 있었다 (적재만 되고 안 쓰였음)
 *
 * 평균은 처음 쓸 때 Neo4j 에서 한 번 계산해 기억한다 (서버가 켜져 있는 동안. 실패하면 다음에 다시)
 * 0 은 "없음" 이 아니라 실제 0 으로 본다 (탄산음료 칼륨 0 등)
 *
 * 쓰이는 곳: services/foodService.js (getFoodNutrition), services/alternativeService.js (후보 재판정),
 *           routes/recommend.js (POST /recommend/label)
 */
const { getSession } = require("../db/neo4j");

const KEYS = ["fiber", "potassium", "phosphorus"];
const round2 = (n) => Math.round(n * 100) / 100;

let averages = null; // Promise<{ byCategory: Map<중분류, {fiber, potassium, phosphorus}>, overall }>

/** 중분류별·전체 평균 (한 번만 계산) */
function loadAverages() {
  if (!averages) {
    averages = (async () => {
      const session = getSession();
      try {
        const avgOf = `avg(toFloat(coalesce(f.fiber, f.dietary_fiber))) AS fiber,
                       avg(toFloat(f.potassium)) AS potassium, avg(toFloat(f.phosphorus)) AS phosphorus`;
        const byCat = await session.run(
          `MATCH (f:Food) WHERE f.unified_mid IS NOT NULL RETURN f.unified_mid AS category, ${avgOf}`,
        );
        const all = await session.run(`MATCH (f:Food) RETURN ${avgOf}`);
        const pick = (r) => Object.fromEntries(KEYS.map((k) => [k, r.get(k)]));
        const byCategory = new Map(byCat.records.map((r) => [r.get("category"), pick(r)]));
        const overall = pick(all.records[0]);
        console.log(`[ML 입력] 식이섬유·인·칼륨 평균 계산: 중분류 ${byCategory.size}개`);
        return { byCategory, overall };
      } finally {
        await session.close();
      }
    })().catch((err) => {
      averages = null; // 다음 요청 때 다시 시도
      throw err;
    });
  }
  return averages;
}

/**
 * 비어 있는(null/undefined) 식이섬유·인·칼륨을 채운 nutrition 을 돌려준다 (원래 객체는 그대로)
 * @param {object} nutrition - foodService.toNutrition 형식 (fiber/potassium/phosphorus 는 없으면 null)
 * @param {string|null} category - 통합 중분류 (Food.unified_mid 또는 labelCategory 결과)
 */
async function fillMlFeatures(nutrition, category) {
  if (KEYS.every((k) => nutrition[k] !== null && nutrition[k] !== undefined)) return nutrition;
  const { byCategory, overall } = await loadAverages();
  const cat = (category && byCategory.get(category)) || {};
  const filled = { ...nutrition };
  for (const k of KEYS) {
    if (filled[k] === null || filled[k] === undefined) {
      const value = cat[k] ?? overall[k] ?? 0;
      filled[k] = round2(value);
    }
  }
  return filled;
}

module.exports = { fillMlFeatures, loadAverages };
