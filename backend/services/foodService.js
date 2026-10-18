/**
 * foodService.js
 *
 * 역할: Neo4j 에서 음식 영양소, 질환별 제한 영양소를 읽어 오는 서비스
 * 주요 함수: getFoodNutrition, getLimitNutrients, toNutrition
 *
 * 이번에 바뀐 점:
 *   - Food 노드 속성 → 판정용 nutrition 객체 변환을 toNutrition 으로 분리해 export
 *     (대체음식 후보는 이름으로 다시 조회하지 않고 이미 읽어 온 속성으로 판정하기 때문)
 *     getFoodNutrition 의 변환 결과는 이전과 완전히 같다.
 *
 * 호출: backend/services/scoreService.js, backend/services/alternativeService.js
 */

//Neo4j에서 숫자값 안전하게 변환하는 함수
function toNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "object" && val.low !== undefined) return val.low;
  return parseFloat(val) || 0;
}

/**
 * Food 노드 속성(snake_case) → 판정용 nutrition 객체
 * 예) { sugar, sodium, saturated_fat, ... } → { sugar, sodium, saturatedFat, ... }
 */
function toNutrition(props) {
  return {
    sugar:        toNum(props.sugar),
    sodium:       toNum(props.sodium),
    saturatedFat: toNum(props.saturated_fat),
    protein:      toNum(props.protein),
    calories:     toNum(props.calories),
    carbohydrate: toNum(props.carbohydrate),
    fat:          toNum(props.fat),
    transFat:     toNum(props.trans_fat),
    cholesterol:  toNum(props.cholesterol),
  };
}

// Neo4j에서 음식 영양소 조회
async function getFoodNutrition(session, foodName) {
  const result = await session.run(
    `MATCH (f:Food {name: $foodName})
     RETURN f.sugar AS sugar, f.sodium AS sodium,
            f.saturated_fat AS saturated_fat, f.protein AS protein,
            f.calories AS calories, f.carbohydrate AS carbohydrate,
            f.fat AS fat, f.trans_fat AS trans_fat,
            f.cholesterol AS cholesterol`,
    { foodName }
  );

  if (result.records.length === 0) return null;

  // 각 영양소 값을 숫자로 변환해서 객체로 변환
  return toNutrition(result.records[0].toObject());
}

// Neo4j에서 질환별 제한 영양소 조회
async function getLimitNutrients(session, diseases) {
  if (!diseases || diseases.length === 0) return [];

  const result = await session.run(
    `UNWIND $diseases AS diseaseName
     MATCH (d:Disease {name: diseaseName})-[:SHOULD_LIMIT]->(n:Nutrient)
     RETURN diseaseName, collect(n.name) AS limitNutrients`,
    { diseases }
  );
  //결과 js객체 배열로 변환
  return result.records.map((r) => ({
    diseaseName:    r.get("diseaseName"),
    limitNutrients: r.get("limitNutrients"),
  }));
}

// 외부에서 사용할 수 있도록 함수 export
module.exports = { getFoodNutrition, getLimitNutrients, toNutrition };
