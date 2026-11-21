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

/**
 * [추가] 분석 화면 상단 "원재료" 표시용: 원재료 이름 배열 (order 순) + 기준 단위(g/ml)
 * 같은 이름의 음식이 여러 개면 원재료가 많은 쪽을 쓴다 (alternativeService 의 ORIGINAL_QUERY 와 같은 방식)
 * 기존 데이터는 order 가 없어 저장된 순서 그대로 나온다
 * 예) 메로나 → { ingredients: ["정제수", "설탕", ...], unit: "ml" }
 */
async function getFoodIngredients(session, foodName) {
  const result = await session.run(
    `MATCH (f:Food {name: $foodName})
     OPTIONAL MATCH (f)-[r:HAS_INGREDIENT]->(i:Ingredient)
     WITH f, r, i ORDER BY r.order
     WITH f, collect(i.name) AS ingredients
     RETURN ingredients, f.unified_mid AS category,
            coalesce(f.serving_unit,
                     CASE WHEN toLower(f.nutrient_reference_amount) ENDS WITH 'ml' THEN 'ml' ELSE 'g' END) AS unit,
            f.piece_amount AS pieceAmount, f.piece_label AS pieceLabel, f.total_amount AS totalAmount
     ORDER BY size(ingredients) DESC
     LIMIT 1`,
    { foodName }
  );
  if (result.records.length === 0) {
    return { ingredients: [], unit: "g", category: null, serving: null };
  }
  const record = result.records[0];
  const pieceAmount = record.get("pieceAmount");
  return {
    ingredients: record.get("ingredients"),
    unit: String(record.get("unit")).toLowerCase() === "ml" ? "ml" : "g",
    // [추가] 통합 중분류 (apply_categories.py 가 넣은 값). 화면의 카테고리 그림에 쓴다
    category: record.get("category") ?? null,
    // [추가] 1개 양 / 총 내용량 (apply_servings.py 가 넣은 값). 없으면 null → 화면은 100g당만
    serving: pieceAmount
      ? {
          pieceAmount: toNum(pieceAmount),
          pieceLabel: record.get("pieceLabel") || "1개",
          totalAmount: toNum(record.get("totalAmount")),
        }
      : null,
  };
}

// 외부에서 사용할 수 있도록 함수 export
module.exports = { getFoodNutrition, getLimitNutrients, toNutrition, getFoodIngredients };
