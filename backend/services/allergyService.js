/**
 * allergyService.js
 *
 * 역할: 사용자 알레르기 목록 vs 식품 원재료 비교
 *
 * 실제 매핑 규칙은 allergenKnowledge.js(사전) / allergenMatcher.js(매칭)에 있다.
 * 이 파일은 Neo4j 에서 원재료를 읽어 와 매처에 넘기는 얇은 계층이다.
 *
 * 이전에는 Ingredient.name 과 알레르기명이 "완전 일치"할 때만 검출해서
 * "밀가루", "탈지분유", "크림" 같은 실제 원재료를 놓쳤다.
 * 지금은 부분 일치 + 파생 원료 사전(크림→우유, 마요네즈→계란 …) + 표시 문구 해석을 사용한다.
 */

const { getIngredientNames } = require("./foodService");
const { matchUserAllergens, findOpaqueIngredients } = require("./allergenMatcher");

/**
 * 원재료명 텍스트 한 덩어리를 사용자 알레르기와 비교한다. (DB 조회/OCR 공통)
 *
 * @param {object} opts
 * @param {string}   opts.ingredientsText  원재료명(표시 문구가 섞여 있어도 됨)
 * @param {string[]} [opts.declared]       라벨 "함유" 표시 항목
 * @param {string[]} [opts.cross]          혼입 가능 표시 항목
 * @param {string[]} opts.userAllergens
 * @returns {{
 *   matches: Array,          // 검출 항목(근거 포함)
 *   names: string[],         // 검출된 사용자 알레르기 이름 (하위 호환)
 *   opaque: string[],        // 세부 성분이 가려진 복합 원료
 *   checked: boolean         // 비교를 수행했는지 (알레르기 미등록이면 false)
 * }}
 */
function analyzeIngredientText({ ingredientsText = "", declared = [], cross = [], userAllergens = [] }) {
  if (!userAllergens || userAllergens.length === 0) {
    return { matches: [], names: [], opaque: [], checked: false };
  }
  const matches = matchUserAllergens({ ingredientsText, declared, cross, userAllergens });
  return {
    matches,
    names: matches.map((m) => m.allergen),
    opaque: findOpaqueIngredients(ingredientsText),
    checked: true,
  };
}

/**
 * DB 식품의 원재료를 읽어 사용자 알레르기와 비교한다.
 * @param {object} session  Neo4j 세션
 * @param {string|{reportNo?:string, foodName?:string}} ref
 * @param {string[]} userAllergens
 */
async function analyzeFoodAllergens(session, ref, userAllergens) {
  if (!userAllergens || userAllergens.length === 0) {
    return { matches: [], names: [], opaque: [], checked: false, ingredientsText: "" };
  }
  const names = await getIngredientNames(session, ref);
  const ingredientsText = names.join(", ");
  return { ...analyzeIngredientText({ ingredientsText, userAllergens }), ingredientsText };
}

/**
 * 하위 호환: 검출된 사용자 알레르기 이름 배열만 반환
 * @returns {Promise<string[]>}
 */
async function checkAllergens(session, foodName, userAllergens) {
  const r = await analyzeFoodAllergens(session, foodName, userAllergens);
  return r.names;
}

module.exports = { checkAllergens, analyzeFoodAllergens, analyzeIngredientText };
