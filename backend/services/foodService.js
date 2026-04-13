//Neo4j에서 숫자값 안전하게 변환하는 함수  
// 주요함수: getFoodNutrition, getlimitNutrents 
function toNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "object" && val.low !== undefined) return val.low;
  return parseFloat(val) || 0;
}

// Neo4j에서 음식 영양소 조회
async function getFoodNutrition(session, foodName) {
  const result = await session.run(
    `MATCH (f:Food {name: $foodName})
     RETURN f.sugar AS sugar, f.sodium AS sodium,
            f.saturated_fat AS saturatedFat, f.protein AS protein,
            f.calories AS calories, f.carbohydrate AS carbohydrate,
            f.fat AS fat, f.trans_fat AS transFat,
            f.cholesterol AS cholesterol`,
    { foodName }
  );

  if (result.records.length === 0) return null;

  const r = result.records[0];
  // 각 영양소 값을 숫자로 변환해서 객체로 변환
  return {
    sugar:        toNum(r.get("sugar")),
    sodium:       toNum(r.get("sodium")),
    saturatedFat: toNum(r.get("saturatedFat")),
    protein:      toNum(r.get("protein")),
    calories:     toNum(r.get("calories")),
    carbohydrate: toNum(r.get("carbohydrate")),
    fat:          toNum(r.get("fat")),
    transFat:     toNum(r.get("transFat")),
    cholesterol:  toNum(r.get("cholesterol")),
  };
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
module.exports = { getFoodNutrition, getLimitNutrients };
