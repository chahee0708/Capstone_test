/**
 * similarity.js
 *
 * 역할: 두 음식의 원재료 목록이 얼마나 비슷한지 0~1 점수로 계산한다 (⑦ 방식).
 *       대체음식 후보를 고를 때 "원래 음식과 원재료가 비슷한 음식" 을 찾는 데 쓴다.
 *       분석에 쓴 Python 구현과 같은 값이 나오도록 규칙을 그대로 옮겼다.
 *
 * 규칙 요약:
 *   1) normalize: 공백 제거 → 접두어 반복 제거(남는 글자 2자 이상일 때만) → 동의어 치환(전체 일치일 때만)
 *      정리 후 같은 이름은 하나로 합치고 첫 등장 순서 유지
 *   2) similarity: n번째 원재료 가중치 = 1/n
 *      A의 원재료가 B에 같은 이름으로 있거나, 둘 다 2자 이상이고 한쪽이 다른 쪽에 포함되면 "겹침"
 *      (B → A 방향도 같은 방식)
 *      점수 = (A 겹침 가중치 합 + B 겹침 가중치 합) ÷ (A 전체 가중치 합 + B 전체 가중치 합)
 *   3) sharedIngredients: A쪽에서 겹친 원재료의 원래 이름을 A 순서대로
 *
 * 이번에 바뀐 점: 새 파일
 *
 * 호출: backend/services/alternativeService.js, backend/tests/similarity.test.js
 */

// 앞에 붙으면 반복해서 떼어내는 접두어 (남는 글자가 2자 이상일 때만)
const PREFIXES = [
  "유기농", "국산", "국내산", "무항생제", "볶음", "볶은", "구운", "동결건조",
  "냉동", "가당", "살균", "저지방", "무지방", "탈지", "순수", "100%",
];

// 동의어: 정리 후 이름 전체가 일치할 때만 대표 이름으로 바꾼다
const SYNONYM_GROUPS = {
  우유: ["원유", "살균우유", "저지우유"],
  설탕: ["백설탕", "하얀설탕", "정백당", "갈색설탕", "유기농설탕"],
  밀가루: ["소맥분", "영양강화밀가루", "강력분", "박력분"],
  소금: ["정제염", "정제소금", "식염", "천일염"],
  된장: ["콩된장", "한식된장", "메주된장"],
  콩기름: ["대두유"],
  계란: ["전란액", "전란"],
  난황: ["난황액", "가염난황"],
  이산화탄소: ["탄산가스"],
  알룰로스: ["액상알룰로스", "알룰로오스", "알룰로오스시럽", "액상알룰로오스"],
};
// 위 표를 "동의어 → 대표 이름" 으로 펼친 것
const SYNONYMS = {};
for (const [canonical, words] of Object.entries(SYNONYM_GROUPS)) {
  for (const w of words) SYNONYMS[w] = canonical;
}

/** 글자 수 (한글·이모지도 1글자로 세기 위해 코드포인트 기준, Python len() 과 같음) */
function charLen(s) {
  return [...s].length;
}

/**
 * 원재료 이름 1개 정리
 * 예) "유기농 원유" → "원유" → (동의어) "우유"
 */
function normalize(name) {
  // 1. 공백 전부 제거
  let s = String(name ?? "").replace(/\s+/g, "");

  // 2. 접두어 반복 제거: 하나라도 떼어내면 처음부터 다시 검사
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of PREFIXES) {
      if (s.startsWith(p) && charLen(s) - charLen(p) >= 2) {
        s = s.slice(p.length);
        changed = true;
        break;
      }
    }
  }

  // 3. 동의어 치환 (전체 일치일 때만)
  return SYNONYMS[s] ?? s;
}

/**
 * 원재료 목록 정리: normalize 후 같은 이름은 첫 등장만 남긴다
 * 반환: [{ norm: 정리된 이름, original: 처음 나온 원래 이름 }]
 */
function normalizeList(list) {
  const out = [];
  const seen = new Set();
  for (const original of list ?? []) {
    const norm = normalize(original);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ norm, original });
  }
  return out;
}

/**
 * x 가 상대 목록(others)과 겹치는지
 * 같은 이름이 있거나, 둘 다 2자 이상이고 한쪽이 다른 쪽에 포함되면 겹침
 */
function overlaps(x, others, otherSet) {
  if (otherSet.has(x)) return true;
  if (charLen(x) < 2) return false;
  return others.some((y) => charLen(y) >= 2 && (y.includes(x) || x.includes(y)));
}

/**
 * 한쪽 목록에서 겹친 원재료 표시 (true/false 배열, 순서 = 정리된 목록 순서)
 */
function overlapFlags(items, otherItems) {
  const others = otherItems.map((o) => o.norm);
  const otherSet = new Set(others);
  return items.map((it) => overlaps(it.norm, others, otherSet));
}

/**
 * 유사도 점수 (0~1)
 * @param {string[]} listA - 원재료 이름 (order 오름차순)
 * @param {string[]} listB - 원재료 이름 (order 오름차순)
 */
function similarity(listA, listB) {
  const a = normalizeList(listA);
  const b = normalizeList(listB);
  if (a.length === 0 && b.length === 0) return 0;

  // n번째(1부터) 원재료 가중치 = 1/n
  const weight = (i) => 1 / (i + 1);
  const flagsA = overlapFlags(a, b);
  const flagsB = overlapFlags(b, a);

  let hit = 0;
  let total = 0;
  a.forEach((_, i) => {
    total += weight(i);
    if (flagsA[i]) hit += weight(i);
  });
  b.forEach((_, i) => {
    total += weight(i);
    if (flagsB[i]) hit += weight(i);
  });
  return total === 0 ? 0 : hit / total;
}

/**
 * A쪽에서 B와 겹친 원재료의 원래 이름 (A 순서대로)
 */
function sharedIngredients(listA, listB) {
  const a = normalizeList(listA);
  const b = normalizeList(listB);
  const flags = overlapFlags(a, b);
  return a.filter((_, i) => flags[i]).map((it) => it.original);
}

module.exports = { normalize, normalizeList, similarity, sharedIngredients };
