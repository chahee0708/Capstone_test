/**
 * allergenMap.js
 *
 * 역할: 알레르기 이름 목록의 단일 출처 (백엔드 JS 공통)
 *       표기 → 통일 이름, 통일 이름 → 그룹(사용자 화면의 묶음 선택지)
 *
 * ※ data_pipeline/clean_foods.py 의 ALLERGEN_MAP / ALLERGEN_PREFIX_MAP / ALLERGEN_GROUPS 와 같게 유지해야 함
 *   (Neo4j Allergy 노드는 파이썬 쪽 목록으로 만들어진다. 한쪽을 고치면 다른 쪽도 고칠 것)
 *   두 목록이 같은지는 backend/test/allergenMap.test.js 가 검사한다
 *
 * 이번 변경: 새 파일. labelParser.js, labelAllergyService.js 에 따로 있던 목록을 여기로 합쳤다
 *            원재료 → 알레르기 키워드 표(INGREDIENT_RULES, 팀 규칙) 추가
 *
 * 호출: backend/services/labelParser.js, backend/services/labelAllergyService.js
 */

// 원본 표기 → 통일 이름 (null = 알레르기 성분 아님)
const ALLERGEN_MAP = {
  "계란": "계란", "달걀": "계란", "알류": "계란", "알류(달걀)": "계란",
  "알류(계란)": "계란", "난류": "계란",
  "쇠고기": "쇠고기", "소고기": "쇠고기",
  "돼지고기": "돼지고기", "돼지 고기": "돼지고기",
  "d-토코페롤(혼합형)": null,
  "굴": "조개류", "홍합": "조개류",
  "이산화황": "아황산류",
  "잣": "잣", "산양유": "산양유",
  "우유": "우유", "대두": "대두", "밀": "밀", "땅콩": "땅콩", "닭고기": "닭고기",
  "새우": "새우", "토마토": "토마토", "오징어": "오징어", "호두": "호두", "게": "게",
  "아황산류": "아황산류", "복숭아": "복숭아", "메밀": "메밀", "고등어": "고등어",
  "헤이즐넛": "헤이즐넛",
};

// 이 글자로 시작하는 표기는 모두 통일 이름으로. 예) "조개류(굴·홍합 포함)" → "조개류"
const ALLERGEN_PREFIX_MAP = { "조개류": "조개류" };

// 통일 이름 → 그룹. 여기 없는 이름은 그룹 = 이름
const ALLERGEN_GROUPS = {
  "호두": "견과류", "헤이즐넛": "견과류", "잣": "견과류",
  "산양유": "우유",
  "새우": "갑각류", "게": "갑각류",
  "고등어": "생선",
};

/**
 * 원재료 이름 → 알레르기 (이름이 다른 파생 원재료 연결용, 예: 유크림 → 우유)
 *
 * ※ 팀 규칙이다. 식약처 「식품등의 표시기준」은 표시 대상 알레르기 목록을 정하지만,
 *   "유크림 → 우유" 같은 파생 원재료 연결표는 제공하지 않는다 (고시 본문은 아직 원문 대조 전).
 *   키워드는 식품 원재료 일반 지식으로 정했으며, 잘못 걸리면 경고가 하나 더 뜨는 쪽으로 둔다.
 *   clean_foods.py 에는 없는 표다 (OCR 라벨 검사에서만 쓴다)
 *
 *   keywords : 원재료 이름(띄어쓰기 제거)에 포함되면 해당
 *   exact    : 원재료 이름 전체가 이 글자일 때만 해당 ("밀감"·"강낭콩" 같은 오탐 방지)
 *   exclude  : 이 글자가 들어 있으면 해당하지 않음
 */
const INGREDIENT_RULES = {
  "우유": { keywords: ["우유", "유크림", "분유", "유청", "유단백", "버터", "치즈", "연유", "카제인", "유당", "발효유", "요구르트"] },
  "계란": { keywords: ["계란", "달걀", "난백", "난황", "전란", "마요네즈"] },
  "밀": { keywords: ["밀가루", "소맥", "통밀", "글루텐", "간장"], exact: ["밀"], exclude: ["메밀", "호밀"] },
  "대두": { keywords: ["대두", "두유", "두부", "된장", "간장", "레시틴"], exact: ["콩"] },
  "땅콩": { keywords: ["땅콩", "피넛"] },
  "메밀": { keywords: ["메밀"] },
  "닭고기": { keywords: ["닭", "계육", "치킨"] },
  "쇠고기": { keywords: ["쇠고기", "소고기", "우육", "비프", "우지"] },
  "돼지고기": { keywords: ["돼지", "돈육", "포크", "라드", "돈지"] },
  "새우": { keywords: ["새우", "크릴"] },
  "게": { keywords: ["게살", "꽃게", "대게"] },
  "조개류": { keywords: ["조개", "굴", "전복", "홍합", "바지락"] },
  "고등어": { keywords: ["고등어"] },
  "오징어": { keywords: ["오징어"] },
  "복숭아": { keywords: ["복숭아"] },
  "토마토": { keywords: ["토마토", "케첩"] },
  "호두": { keywords: ["호두"] },
  "잣": { keywords: ["잣"] },
  "헤이즐넛": { keywords: ["헤이즐넛"] },
  "아황산류": { keywords: ["아황산", "이산화황"] },
};

/** 원재료 이름 하나 → 들어 있는 알레르기 통일 이름 목록 */
function allergensInIngredient(ingredient) {
  const compact = String(ingredient).replace(/\s+/g, "");
  return Object.entries(INGREDIENT_RULES)
    .filter(([, rule]) => {
      if ((rule.exclude ?? []).some((word) => compact.includes(word))) return false;
      return (
        (rule.exact ?? []).includes(compact) ||
        rule.keywords.some((word) => compact.includes(word))
      );
    })
    .map(([allergen]) => allergen);
}

// 띄어쓰기를 지운 표기로 찾기 위한 표 ("돼지 고기" → "돼지고기")
const COMPACT_MAP = Object.fromEntries(
  Object.entries(ALLERGEN_MAP).map(([name, unified]) => [name.replace(/\s+/g, ""), unified]),
);

/**
 * 표기 → 통일 이름. 목록에 없으면 null
 * 띄어쓰기와 뒤 괄호는 무시한다. 예) "알류(달걀)" → 계란, "조개류(굴)" → 조개류
 */
function toUnifiedAllergen(name) {
  const compact = String(name).replace(/\s+/g, "");
  if (COMPACT_MAP[compact]) return COMPACT_MAP[compact];
  for (const [prefix, unified] of Object.entries(ALLERGEN_PREFIX_MAP)) {
    if (compact.startsWith(prefix)) return unified;
  }
  return COMPACT_MAP[compact.replace(/\(.*\)$/, "")] ?? null;
}

/** 목록에 있는 알레르기 이름인지 */
const isKnownAllergen = (name) => toUnifiedAllergen(name) !== null;

/** 통일 이름의 그룹 (없으면 이름 그대로) */
const groupOf = (unified) => ALLERGEN_GROUPS[unified] ?? unified;

module.exports = {
  ALLERGEN_MAP,
  ALLERGEN_PREFIX_MAP,
  ALLERGEN_GROUPS,
  INGREDIENT_RULES,
  allergensInIngredient,
  toUnifiedAllergen,
  isKnownAllergen,
  groupOf,
};
