// Neo4j에서 숫자값 안전하게 변환하는 함수
// 주요함수: getFoodRecord, getFoodNutrition, getIngredientNames, searchFoods, getLimitNutrients
function toNum(val) {
  if (val === null || val === undefined) return 0;
  // neo4j-driver 의 Integer 타입 (정수 속성)
  if (typeof val === "object" && typeof val.toNumber === "function") return val.toNumber();
  if (typeof val === "object" && val.low !== undefined) return val.low;
  return parseFloat(val) || 0;
}

const NUTRITION_RETURN = `f.name AS name, f.manufacturer AS manufacturer,
            f.product_report_no AS reportNo,
            f.sugar AS sugar, f.sodium AS sodium,
            f.saturated_fat AS saturatedFat, f.protein AS protein,
            f.calories AS calories, f.carbohydrate AS carbohydrate,
            f.fat AS fat, f.trans_fat AS transFat,
            f.cholesterol AS cholesterol,
            f.dietary_fiber AS fiber, f.potassium AS potassium,
            f.phosphorus AS phosphorus`;

/**
 * 식품 조회 참조: 품목보고번호가 있으면 그것으로(정확), 없으면 제품명으로 조회한다.
 * @typedef {{ reportNo?: string, foodName?: string }} FoodRef
 */
function normalizeRef(ref) {
  if (typeof ref === "string") return { foodName: ref };
  return { reportNo: ref?.reportNo, foodName: ref?.foodName };
}

function matchClause(ref) {
  const r = normalizeRef(ref);
  if (r.reportNo) return { clause: "MATCH (f:Food {product_report_no: $key})", key: String(r.reportNo) };
  return { clause: "MATCH (f:Food {name: $key})", key: String(r.foodName || "") };
}

/**
 * 식품 한 건의 영양성분(100g/100ml 기준)과 기본 정보를 조회한다.
 * fiber/potassium/phosphorus 는 data/load_backend_schema.py 로 적재된 속성이며,
 * 아직 적재되지 않은 DB 에서는 null → 0 으로 처리된다.
 * @param {object} session
 * @param {FoodRef|string} ref
 * @returns {Promise<null | { nutrition: object, meta: { name: string, manufacturer: string|null, reportNo: string|null } }>}
 */
async function getFoodRecord(session, ref) {
  const { clause, key } = matchClause(ref);
  if (!key) return null;

  const result = await session.run(
    `${clause}
     RETURN ${NUTRITION_RETURN}
     LIMIT 1`,
    { key }
  );

  if (result.records.length === 0) return null;

  const r = result.records[0];
  return {
    meta: {
      name: r.get("name"),
      manufacturer: r.get("manufacturer") ?? null,
      reportNo: r.get("reportNo") ?? null,
    },
    // 각 영양소 값을 숫자로 변환해서 객체로 변환
    nutrition: {
      sugar:        toNum(r.get("sugar")),
      sodium:       toNum(r.get("sodium")),
      saturatedFat: toNum(r.get("saturatedFat")),
      protein:      toNum(r.get("protein")),
      calories:     toNum(r.get("calories")),
      carbohydrate: toNum(r.get("carbohydrate")),
      fat:          toNum(r.get("fat")),
      transFat:     toNum(r.get("transFat")),
      cholesterol:  toNum(r.get("cholesterol")),
      fiber:        toNum(r.get("fiber")),
      potassium:    toNum(r.get("potassium")),
      phosphorus:   toNum(r.get("phosphorus")),
    },
  };
}

// Neo4j에서 음식 영양소 조회 (영양성분만 필요한 호출용)
async function getFoodNutrition(session, ref) {
  const rec = await getFoodRecord(session, ref);
  return rec ? rec.nutrition : null;
}

/**
 * 식품의 원재료 항목 이름 목록 (Ingredient 노드)
 * @returns {Promise<string[]>}
 */
async function getIngredientNames(session, ref) {
  const { clause, key } = matchClause(ref);
  if (!key) return [];
  const result = await session.run(
    `${clause}-[:HAS_INGREDIENT]->(i:Ingredient)
     RETURN DISTINCT i.name AS name`,
    { key }
  );
  return result.records.map((r) => r.get("name")).filter(Boolean);
}

/**
 * 식품명 검색 (자동완성용)
 * - 정확히 일치하거나 앞부분이 일치하는 이름을 먼저, 그 다음 부분 일치 순으로 반환한다.
 * - 같은 이름의 제품이 여러 개일 수 있어 제조사·품목보고번호를 함께 돌려준다.
 *
 * @param {object} session
 * @param {string} query - 2자 이상의 검색어
 * @param {number} [limit=10]
 * @returns {Promise<Array<{ name: string, manufacturer: string|null, reportNo: string|null }>>}
 */
async function searchFoods(session, query, limit = 10) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];

  const result = await session.run(
    `MATCH (f:Food)
     WHERE f.name CONTAINS $q
     RETURN f.name AS name, f.manufacturer AS manufacturer, f.product_report_no AS reportNo
     ORDER BY CASE WHEN f.name = $q THEN 0 WHEN f.name STARTS WITH $q THEN 1 ELSE 2 END,
              size(f.name), f.name
     LIMIT toInteger($limit)`,
    { q, limit }
  );

  return result.records.map((r) => ({
    name: r.get("name"),
    manufacturer: r.get("manufacturer") ?? null,
    reportNo: r.get("reportNo") ?? null,
  }));
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
module.exports = {
  getFoodRecord,
  getFoodNutrition,
  getIngredientNames,
  searchFoods,
  getLimitNutrients,
  toNum,
};
