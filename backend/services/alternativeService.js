/**
 * alternativeService.js
 *
 * 역할: 원래 음식이 "주의"/"비추천" 일 때, 같은 중분류(category_mid) 안에서
 *       원재료가 비슷하고(유사도 ≥ SIM_THRESHOLD) 사용자 기준 판정이 더 나은 음식을 최대 3개 찾는다.
 *
 * 처리 순서 (성능 때문에 이 순서를 지킨다):
 *   1. 원래 음식의 category_mid / 원재료 조회 → 없으면 [] (기존 3,000여 개 음식)
 *   2. 후보 조회 (Cypher 1번): 같은 중분류, alt_candidate = true, 원래 음식 제외, 원재료 1개 이상.
 *      원재료는 order 순, 영양소 속성 함께 (사용자 알레르기는 고려하지 않는다)
 *   3. 모든 후보 유사도 계산 → 기준 미만 제거 → 유사도 높은 순 정렬
 *   4. 위에서부터 사용자 기준으로 재판정 (원래 음식과 같은 판정 함수) → 등급 필터 통과 시 추가
 *      MAX_ALTERNATIVES 개 차면 즉시 중단. 유사도가 같으면(소수 둘째 자리) 등급이 좋은 쪽 먼저,
 *      등급도 같으면 음식 이름 가나다순 → 이름도 같으면 report_no 순 (항상 같은 결과)
 *   5. 재판정 중 에러가 난 후보는 건너뛰고 로그만 남김
 *
 * 등급 필터:
 *   - 후보 등급이 원래 verdict 보다 더 나은 것 (비추천 → 주의·추천 / 주의 → 추천)
 *
 * 이번 변경(대체음식 추천에서 알레르기 미고려):
 *   - [삭제] 사용자 알레르기(이름 또는 그룹)와 겹치는 후보 제외 조건
 *   - [삭제] 사용자 알레르기가 있을 때 알레르기 정보가 없는 후보 제외 조건
 *     (밀 알레르기 사용자는 만두처럼 후보 전부가 밀을 포함하는 경우 대체음식이 0개가 되던 문제)
 *
 * 결과 항목: { name, verdict, similarity, keyNutrient: { label, unit, before, after } | null, sharedIngredients }
 *
 * 이전 변경:
 *   - [삭제] allergyOverride 등급 필터 분기. verdict 가 알레르기로 바뀌지 않으므로 필요 없다
 *   - [변경] 동점 정렬: 유사도(소수 둘째 자리)·등급이 같으면 이름 가나다순 → report_no 순
 *     (이전에는 원래 유사도 순이라, 완전히 같은 값이면 Neo4j 반환 순서에 따라 결과가 달라질 수 있었다)
 *   - [추가] 사용자 알레르기가 있으면 알레르기 정보(CONTAINS_ALLERGEN)가 하나도 없는 후보는 제외
 *     (원본 데이터에 알레르기 표기가 빠진 흰우유 등이 우유 알레르기 사용자에게 추천되던 문제)
 *
 * 호출: backend/routes/recommend.js (영양 판정이 주의/비추천일 때)
 */

const { SIM_THRESHOLD, MAX_ALTERNATIVES } = require("../config/alternatives");
const { similarity, sharedIngredients } = require("./similarity");
const { toNutrition } = require("./foodService");
const { judgeDiseaseNutrition, judgeHealthyNutrition } = require("./scoreService");

// 등급 순서: 추천 > 주의 > 비추천
const RANK = { 추천: 2, 주의: 1, 비추천: 0 };

// 판정 근거(reasons)의 영양소 이름 → nutrition 객체 키
const NUTRIENT_KEY = {
  나트륨: "sodium",
  당류: "sugar",
  포화지방: "saturatedFat",
  트랜스지방: "transFat",
  지방: "fat",
  탄수화물: "carbohydrate",
  단백질: "protein",
};

const round1 = (n) => Math.round(n * 10) / 10;
// [추가] 문자열 비교 (코드 순). 동점 후보 정렬에 사용
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (n) => Math.round(n * 100) / 100;

// 원래 음식 조회: 중분류 + 원재료(order 순). 같은 이름이 여러 개면 중분류가 있는 쪽 우선
const ORIGINAL_QUERY = `
  MATCH (f:Food {name: $name})
  OPTIONAL MATCH (f)-[r:HAS_INGREDIENT]->(i:Ingredient)
  WITH f, r, i ORDER BY r.order
  WITH f, collect(i.name) AS ingredients
  RETURN f.report_no AS reportNo, f.category_mid AS categoryMid, ingredients
  ORDER BY categoryMid IS NULL, size(ingredients) DESC
  LIMIT 1`;

// 후보 조회 (한 번에): 원재료 order 순 + 영양소 속성
const CANDIDATE_QUERY = `
  MATCH (c:Food {category_mid: $categoryMid})
  WHERE c.alt_candidate = true
    AND c.name <> $name
    AND (c.report_no IS NULL OR $reportNo IS NULL OR c.report_no <> $reportNo)
  MATCH (c)-[r:HAS_INGREDIENT]->(i:Ingredient)
  WITH c, r, i ORDER BY r.order
  WITH c, collect(i.name) AS ingredients
  RETURN c.name AS name, c.report_no AS reportNo, ingredients,
         c { .sugar, .sodium, .saturated_fat, .protein, .calories,
             .carbohydrate, .fat, .trans_fat, .cholesterol } AS props`;

/**
 * 원래 음식에서 문제가 된 영양소 1개 고르기
 * reasons 중 영양소가 있는 것(ML 트랙 제외)에서: 비추천 우선 → 기준 대비 배수가 큰 것
 * (프론트 VerdictExplanation 이 무질환 사용자에게 보여주는 "가장 심각한 영양소" 와 같은 규칙)
 * 질환 사용자의 reasons 는 전부 질환 타겟 영양소이므로 같은 규칙으로 고른다.
 * 특정할 수 없으면 null
 */
function pickKeyNutrient(reasons) {
  const ratio = (r) => (r.amountPer100g ?? 0) / (r.thresholdPer100g || 1);
  const list = (reasons ?? []).filter((r) => r.nutrient && NUTRIENT_KEY[r.nutrient]);
  if (list.length === 0) return null;
  return [...list].sort(
    (a, b) =>
      (b.verdict === "비추천" ? 1 : 0) - (a.verdict === "비추천" ? 1 : 0) ||
      ratio(b) - ratio(a),
  )[0];
}

/** 사용자 기준 판정 — 원래 음식과 같은 판정 함수 (질병 유무로 갈림) */
async function judge(nutrition, user) {
  if (user.diseases && user.diseases.length > 0) {
    return judgeDiseaseNutrition(
      nutrition,
      user.diseases,
      user.weight,
      user.height,
      user.age,
      user.gender,
      user.diseaseDetails,
    );
  }
  return judgeHealthyNutrition(nutrition, user.weight, user.height, user.age, user.gender);
}

/**
 * 대체음식 찾기
 *
 * @param {object} session        - Neo4j 세션
 * @param {string} originalFood   - 원래 음식 이름
 * @param {object} user           - { diseases, allergens, weight, height, age, gender, diseaseDetails }
 * @param {object} originalResult - { verdict, reasons, nutrition }
 * @returns {Promise<Array>} alternatives 배열 (없으면 [])
 */
async function findAlternatives(session, originalFood, user, originalResult) {
  // ── 0. 실행 조건: 주의/비추천일 때만 ──
  if (originalResult.verdict !== "주의" && originalResult.verdict !== "비추천") return [];

  // ── 1. 원래 음식의 중분류·원재료 ──
  const orig = await session.run(ORIGINAL_QUERY, { name: originalFood });
  const o = orig.records[0];
  const categoryMid = o?.get("categoryMid");
  const origIngredients = o?.get("ingredients") ?? [];
  if (!categoryMid || origIngredients.length === 0) return []; // 기존 음식(중분류·원재료 없음)

  // ── 2. 후보 조회 (Cypher 1번) ──
  const cand = await session.run(CANDIDATE_QUERY, {
    categoryMid,
    name: originalFood,
    reportNo: o.get("reportNo") ?? null,
  });

  // ── 3a/3b. 유사도 계산 → 기준 미만 제거 → 높은 순 정렬 ──
  const ranked = cand.records
    .map((r) => {
      const ingredients = r.get("ingredients");
      return {
        name: r.get("name"),
        reportNo: r.get("reportNo") ?? "", // [추가] 동점 정렬용
        ingredients,
        props: r.get("props"),
        sim: similarity(origIngredients, ingredients),
      };
    })
    .filter((c) => c.sim >= SIM_THRESHOLD)
    .sort((a, b) => b.sim - a.sim);

  // ── 등급 필터 기준: 원래 판정보다 더 나은 것만 ──
  const passes = (verdict) => RANK[verdict] > RANK[originalResult.verdict];

  // 문제 영양소 (결과 항목의 keyNutrient 용)
  const key = pickKeyNutrient(originalResult.reasons);
  const keyField = key ? NUTRIENT_KEY[key.nutrient] : null;

  // ── 3c/3d/3e. 유사도가 같은(소수 둘째 자리) 후보끼리 묶어서 재판정 → 등급 좋은 순으로 추가 ──
  const results = [];
  let i = 0;
  while (i < ranked.length && results.length < MAX_ALTERNATIVES) {
    // 같은 유사도 묶음
    const groupSim = round2(ranked[i].sim);
    const group = [];
    while (i < ranked.length && round2(ranked[i].sim) === groupSim) group.push(ranked[i++]);

    // 묶음 안의 후보를 재판정 (에러 난 후보는 건너뛰고 로그만)
    const judged = [];
    for (const c of group) {
      try {
        const nutrition = toNutrition(c.props);
        const result = await judge(nutrition, user);
        if (result && passes(result.verdict)) judged.push({ ...c, nutrition, verdict: result.verdict });
      } catch (err) {
        console.error(`[대체음식] 후보 재판정 실패 (${c.name}):`, err.message);
      }
    }

    // [변경] 같은 유사도 묶음 안 정렬: 등급 좋은 쪽 먼저 → 이름 가나다순 → report_no 순
    //        (문자열 코드 순 비교: 한글 완성형은 유니코드가 가나다 순이고, 실행 환경과 무관하게 항상 같다)
    judged.sort((a, b) => RANK[b.verdict] - RANK[a.verdict] || compareText(a.name, b.name) || compareText(a.reportNo, b.reportNo));

    for (const c of judged) {
      if (results.length >= MAX_ALTERNATIVES) break; // 다 찼으면 즉시 중단
      results.push({
        name: c.name,
        verdict: c.verdict,
        similarity: round2(c.sim),
        // 원래 음식에서 문제가 된 영양소 (100g/100ml 기준, 소수 첫째 자리)
        keyNutrient: key
          ? {
              label: key.nutrient,
              unit: key.unit,
              before: round1(originalResult.nutrition?.[keyField] ?? 0),
              after: round1(c.nutrition[keyField] ?? 0),
            }
          : null,
        // 원래 음식 쪽에서 겹친 원재료 이름 (원래 음식의 원재료 순서, 최대 2개)
        sharedIngredients: sharedIngredients(origIngredients, c.ingredients).slice(0, 2),
      });
    }
  }

  return results;
}

module.exports = { findAlternatives };
