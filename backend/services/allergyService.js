/**
 * allergyService.js
 *
 * 역할: 사용자 알레르기 목록과 음식의 알레르기 성분을 비교해서,
 *       해당 음식에서 걸리는 알레르기 이름 배열을 돌려준다.
 *
 * 호출: routes/recommend.js (POST /recommend, Step 5)
 *       → 알레르기가 있는 사용자만 checkAllergens(session, foodName, allergens) 호출
 *
 * ── 이번 변경 ────────────────────────────────────────────────
 *   - 새 방식: (Food)-[:CONTAINS_ALLERGEN]->(Allergy) 관계로 판정
 *     Allergy.name 또는 Allergy.group(묶음: 견과류·갑각류·생선 등)이 사용자 목록에 있으면 해당
 *     반환 이름은 사용자가 고른 이름 기준
 *       예) 사용자 "갑각류", 음식에 새우 → "갑각류(새우)"
 *           사용자 "새우",   음식에 새우 → "새우"
 *   - 기존 방식 유지: 음식에 CONTAINS_ALLERGEN 관계가 하나도 없을 때만
 *     예전처럼 HAS_INGREDIENT 의 Ingredient.name 으로 판정 (emart 적재 전 기존 음식용)
 *   - 결과 중복 제거
 *   - 함수 이름, 인자, 반환 형식(문자열 배열)은 그대로
 */

// 새 방식: 음식의 CONTAINS_ALLERGEN 관계 수 + 사용자 목록과 이름/그룹이 맞는 Allergy
const NEW_QUERY = `
  MATCH (f:Food {name: $foodName})
  OPTIONAL MATCH (f)-[:CONTAINS_ALLERGEN]->(a:Allergy)
  WITH collect(a) AS allergies
  RETURN size(allergies) AS relCount,
         [a IN allergies WHERE a.name IN $allergens OR a.group IN $allergens
            | {name: a.name, group: a.group}] AS matched`;

// 기존 방식: 원재료 이름이 사용자 알레르기 이름과 같은 것
const LEGACY_QUERY = `
  MATCH (f:Food {name: $foodName})-[:HAS_INGREDIENT]->(i:Ingredient)
  WHERE i.name IN $allergens
  RETURN i.name AS allergen`;

async function checkAllergens(session, foodName, userAllergens) {
  if (!userAllergens || userAllergens.length === 0) return [];

  // 1. 새 방식 조회
  const result = await session.run(NEW_QUERY, { foodName, allergens: userAllergens });
  const record = result.records[0];
  const relCount = record ? Number(record.get("relCount")) : 0;

  // 2. CONTAINS_ALLERGEN 관계가 없는 음식(기존 음식) → 예전 방식으로 판정
  if (relCount === 0) {
    const legacy = await session.run(LEGACY_QUERY, { foodName, allergens: userAllergens });
    return [...new Set(legacy.records.map((r) => r.get("allergen")))];
  }

  // 3. 사용자가 고른 이름 기준으로 반환 이름 만들기
  //    - 이름이 직접 맞으면 그 이름 ("새우")
  //    - 그룹으로 맞으면 "그룹(성분)" ("갑각류(새우)"). 그룹 = 이름인 경우("우유")는 이름만
  const matched = record.get("matched");
  const found = [];
  for (const userName of userAllergens) {
    for (const a of matched) {
      if (a.name === userName) {
        found.push(userName);
      } else if (a.group === userName) {
        found.push(`${userName}(${a.name})`);
      }
    }
  }

  // 4. 중복 제거 (같은 이름을 여러 번 고른 경우 등)
  return [...new Set(found)];
}

module.exports = { checkAllergens };
