/**
 * labelAllergyService.js
 *
 * 역할: OCR 라벨에서 읽은 알레르기 이름을 사용자 알레르기와 비교한다 (Neo4j 조회 없음)
 *       반환 이름은 allergyService.checkAllergens 와 같은 규칙이다
 *         예) 사용자 "갑각류", 라벨 새우 → "갑각류(새우)" / 사용자 "우유", 라벨 우유 → "우유"
 *
 * 이번 변경: 새 파일
 *
 * 호출: backend/routes/recommend.js (POST /recommend/label)
 */

// 표기 → 통일 이름, 그룹. 출처: data_pipeline/clean_foods.py 의 ALLERGEN_MAP, ALLERGEN_GROUPS
// (파이프라인에 표기를 추가하면 여기도 같이 추가할 것)
const ALLERGEN_MAP = {
  계란: "계란", 달걀: "계란", 알류: "계란", 난류: "계란",
  쇠고기: "쇠고기", 소고기: "쇠고기",
  돼지고기: "돼지고기",
  굴: "조개류", 홍합: "조개류",
  이산화황: "아황산류",
  잣: "잣", 산양유: "산양유",
  우유: "우유", 대두: "대두", 밀: "밀", 땅콩: "땅콩", 닭고기: "닭고기",
  새우: "새우", 토마토: "토마토", 오징어: "오징어", 호두: "호두", 게: "게",
  아황산류: "아황산류", 복숭아: "복숭아", 메밀: "메밀", 고등어: "고등어",
  헤이즐넛: "헤이즐넛",
};

const ALLERGEN_GROUPS = {
  호두: "견과류", 헤이즐넛: "견과류", 잣: "견과류",
  산양유: "우유",
  새우: "갑각류", 게: "갑각류",
  고등어: "생선",
};

/** 띄어쓰기와 뒤 괄호를 지운 뒤 통일 이름으로. 목록에 없으면 지운 글자 그대로 */
function unify(name) {
  const base = String(name).replace(/\s+/g, "").replace(/\(.*\)$/, "");
  if (base.startsWith("조개류")) return "조개류";
  return ALLERGEN_MAP[base] ?? base;
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
      } else if ((ALLERGEN_GROUPS[unified] ?? unified) === userName) {
        found.push(`${userName}(${unified})`);
      }
    }
  }
  return [...new Set(found)];
}

module.exports = { matchLabelAllergens };
