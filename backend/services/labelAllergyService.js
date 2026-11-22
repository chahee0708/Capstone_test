/**
 * labelAllergyService.js
 *
 * 역할: OCR 라벨에서 읽은 알레르기 이름을 사용자 알레르기와 비교한다 (Neo4j 조회 없음)
 *       반환 이름은 allergyService.checkAllergens 와 같은 규칙이다
 *         예) 사용자 "갑각류", 라벨 새우 → "갑각류(새우)" / 사용자 "우유", 라벨 우유 → "우유"
 *
 * 이번 변경(fix/ocr-improve):
 *   - [변경] 알레르기 목록을 allergenMap.js 공통 파일에서 가져온다 (비교 결과 같음)
 *   - [추가] isAllergyCheckIncomplete: 알레르기 확인을 끝낼 수 없는지
 *       함유 문구가 없거나, 함유·혼입 이름 중 목록에 없는 것(잘못 읽은 글자)이 있으면 true
 *       기준량·식품유형 같은 다른 OCR 경고는 조건에 넣지 않는다
 *   - [추가] findIngredientAllergens: 원재료 이름으로 사용자 알레르기 찾기 (allergenMap.INGREDIENT_RULES)
 *
 * 호출: backend/routes/recommend.js (POST /recommend/label)
 */

const { toUnifiedAllergen, groupOf, allergensInIngredient } = require("./allergenMap");

/** 통일 이름으로. 목록에 없으면 띄어쓰기를 지운 글자 그대로 (사용자가 직접 적은 이름 비교용) */
function unify(name) {
  return toUnifiedAllergen(name) ?? String(name).replace(/\s+/g, "");
}

/**
 * 라벨 이름 중 사용자 알레르기에 걸리는 것
 * @param {string[]} labelNames   - 라벨에서 읽은 이름 (allergenText 또는 mayContain)
 * @param {string[]} userAllergens - 사용자 알레르기 (이름 또는 그룹)
 * @returns {string[]} 걸린 이름 (중복 제거)
 */
function matchLabelAllergens(labelNames, userAllergens) {
  const found = [];
  for (const userName of userAllergens) {
    const userUnified = unify(userName);
    for (const labelName of labelNames) {
      const unified = unify(labelName);
      if (unified === userUnified) {
        found.push(userName);
      } else if (groupOf(unified) === userName) {
        found.push(`${userName}(${unified})`);
      }
    }
  }
  return [...new Set(found)];
}

/**
 * 원재료 이름으로 사용자 알레르기 찾기 (예: 유크림 → 우유)
 * @param {string[]} ingredients   - 라벨 원재료 이름
 * @param {string[]} userAllergens - 사용자 알레르기 (이름 또는 그룹)
 * @returns {{ allergen: string, ingredient: string }[]} 걸린 알레르기(사용자 기준 이름)와 원재료
 */
function findIngredientAllergens(ingredients, userAllergens) {
  const found = [];
  for (const ingredient of ingredients) {
    for (const allergen of matchLabelAllergens(allergensInIngredient(ingredient), userAllergens)) {
      found.push({ allergen, ingredient });
    }
  }
  return found;
}

/**
 * 알레르기 확인을 끝낼 수 없는지 (true 면 "안전" 으로 표시하지 않는다)
 * @param {string[]} allergenText - 라벨의 함유 이름
 * @param {string[]} mayContain   - 라벨의 혼입 가능 이름
 */
function isAllergyCheckIncomplete(allergenText, mayContain) {
  if (allergenText.length === 0) return true; // 함유 문구를 못 찾음
  return [...allergenText, ...mayContain].some((name) => toUnifiedAllergen(name) === null);
}

module.exports = { matchLabelAllergens, findIngredientAllergens, isAllergyCheckIncomplete };
