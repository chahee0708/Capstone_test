/**
 * allergenKnowledge.js
 *
 * 알레르기 성분 지식베이스.
 *
 * 식품 원재료명에는 알레르기 항목 이름이 그대로 나오지 않는 경우가 많다.
 *   - "크림", "생크림", "버터", "유청", "카제인나트륨"  →  우유 유래
 *   - "마요네즈", "난백분", "전란액"                    →  계란(알류) 유래
 *   - "빵가루", "튀김가루", "양조간장"                   →  밀 / 대두 유래
 * 이 파일은 "원재료명 → 알레르기 항목" 연결 규칙을 한 곳에 모은다.
 *
 * 연결 강도(level)
 *   declared   : 제품 라벨의 "○○ 함유" 표시
 *   ingredient : 알레르기 원료 자체 (우유, 밀가루, 땅콩 …)
 *   derived    : 해당 원료로 만든 가공 원료 (크림→우유, 마요네즈→계란, 양조간장→대두·밀 …)
 *   possible   : 함유 가능성이 있는 원료 (식물성크림의 카제인, 젤라틴, 가수분해단백 …)
 *   cross      : 같은 제조시설 사용 등 "혼입 가능" 표시
 *
 * 설계 원칙: 알레르기는 "놓침"이 "과잉 경고"보다 훨씬 위험하다.
 *            애매하면 경고하되, 강도를 구분해서 사용자가 판단할 수 있게 한다.
 *
 * 키워드 규칙
 *   - 공백/기호를 제거하고 소문자로 맞춘 문자열의 "부분 일치"로 검사한다.
 *   - "=게" 처럼 = 로 시작하면 원재료 한 항목 전체가 정확히 일치할 때만 일치한다.
 *   - exclude 에 있는 문자열은 검사 전에 제거한다(예: 메밀 → '밀' 오탐 방지).
 *
 * 항목 이름은 식품 등의 표시기준(식약처) 알레르기 유발물질 19종을 기본으로 하고,
 * 사용자가 흔히 쓰는 묶음(견과류, 갑각류, 생선, 글루텐)은 GROUPS 로 정의한다.
 */

// ─────────────────────────────────────────────────────────────
// 1. 표준 알레르기 항목
// ─────────────────────────────────────────────────────────────
const ALLERGENS = {
  우유: {
    aliases: ["우유", "유제품", "유류", "milk", "dairy"],
    ingredient: ["우유", "원유", "밀크", "분유", "유청", "유장", "탈지유", "전지유", "산양유", "염소유", "생유", "milk", "whey", "casein"],
    derived: [
      "크림", "생크림", "휘핑", "유크림", "크림치즈", "사워크림", "커피크림", "크림분말", "크림파우더", "크림소스", "크림스프",
      "버터", "치즈", "카제인", "카세인", "락토오스", "락토스", "락토페린", "락토글로불린", "락트알부민", "유당", "연유",
      "요거트", "요구르트", "요쿠르트", "발효유", "커드", "아이스크림", "아이스밀크", "슈크림", "커스터드", "카스타드",
      "라떼", "유단백", "유지방", "화이트초콜릿",
      // 식품 DB 의 원재료 표기(품목제조보고 수준): "유함유가공품", "가공유", "유가공품" 등
      "유함유", "유가공", "가공유", "가공우유", "조제유", "유성분", "유장",
    ],
    possible: [
      "식물성크림", "식물성휘핑", "크리머", "프림", "마가린", "밀크초콜릿", "초콜릿", "초코",
      "빵류", "케이크", "쿠키", "머핀", "크루아상", "파이", "와플", "도넛", "카스테라",
    ],
    exclude: [
      "코코넛크림", "코코넛밀크", "아몬드밀크", "오트밀크", "귀리밀크", "쌀밀크", "소이밀크", "두유밀크",
      "코코아버터", "카카오버터", "시어버터", "땅콩버터", "아몬드버터", "견과버터", "버터넛", "버터플라이",
      "락토바실러스", "락토바실루스", "락토바실", "락토코쿠스", "락토바실러",
      "핸드크림", "선크림", "크림색",
    ],
  },
  계란: {
    aliases: ["계란", "달걀", "달갈", "알류", "난류", "egg", "eggs"],
    ingredient: ["계란", "달걀", "달갈", "전란", "난백", "난황", "난류", "란액", "알류", "난각", "에그", "메추리알", "오리알", "egg"],
    derived: [
      "마요네즈", "오믈렛", "스크램블", "알부민", "오브알부민", "난백분", "난황분", "슈크림", "카스타드", "커스터드", "머랭", "리소자임",
      // 식품 DB 표기: "알가열제품"(계란말이 등), "알가공품", "알함유가공품"
      "알가열", "알가공", "알제품", "알함유",
    ],
    possible: ["빵류", "케이크", "카스테라", "쿠키", "머핀", "와플", "도넛", "마카롱", "파운드"],
    exclude: ["에그플랜트"],
  },
  메밀: {
    aliases: ["메밀", "buckwheat"],
    ingredient: ["메밀", "buckwheat"],
    derived: ["소바"],
    possible: [],
    exclude: [],
  },
  땅콩: {
    aliases: ["땅콩", "피넛", "낙화생", "peanut"],
    ingredient: ["땅콩", "낙화생", "피넛", "peanut"],
    derived: [],
    possible: [],
    exclude: [],
  },
  대두: {
    aliases: ["대두", "콩", "soy", "soya", "소이"],
    ingredient: ["대두", "콩", "soy", "soya", "두부", "두유", "비지", "서리태", "청국장", "낫또", "나또", "템페", "메주", "백태", "약콩", "대두박"],
    derived: ["간장", "된장", "고추장", "쌈장", "춘장", "미소", "레시틴", "분리대두", "탈지대두", "콩가루", "콩기름", "쯔유"],
    possible: ["유화제", "식물성단백", "가수분해단백", "가수분해식물성단백", "두류가공품", "장류"],
    exclude: ["완두콩", "완두", "강낭콩", "병아리콩", "렌틸콩", "녹두", "커피콩", "카카오콩", "로커스트콩", "로커스트빈", "구아콩", "타마린드콩", "캐롭콩"],
  },
  밀: {
    aliases: ["밀", "소맥", "wheat", "밀가루"],
    ingredient: ["밀", "소맥", "맥분", "wheat", "통밀", "글루텐", "강력분", "중력분", "박력분", "듀럼", "세몰리나", "스펠트", "쿠스쿠스"],
    derived: [
      "빵가루", "튀김가루", "부침가루", "프라이드믹스", "만두피", "양조간장", "비스킷", "비스켓", "크래커", "건빵",
      "시리얼", "토르티야", "또띠아", "밀맥아",
      // 면류: 식품 DB 에는 "유탕면", "건면", "숙면" 처럼 원료 대신 면의 종류만 적힌 제품이 많다
      "유탕면", "건면", "숙면", "생면", "칼국수", "수제비", "우동", "소면", "중면", "스파게티", "파스타", "마카로니",
      "라멘", "짜장면", "라면",
    ],
    possible: [
      "간장", "국수", "면류", "냉면", "가수분해단백", "맥아", "어묵", "과자", "과자류", "빵류", "제과", "케이크", "쿠키", "머핀",
      "파이", "와플", "도넛", "카스테라", "팬케이크", "핫케이크", "빵",
    ],
    exclude: ["메밀", "밀크", "밀감", "아밀라아제", "아밀라제", "아밀로", "밀랍", "밀납", "밀푀유", "쌀국수", "쌀면", "곤약면", "당면", "메밀면"],
  },
  고등어: {
    aliases: ["고등어", "mackerel"],
    ingredient: ["고등어", "mackerel"],
    derived: [],
    possible: [],
    exclude: [],
  },
  게: {
    aliases: ["게", "꽃게", "대게", "크랩", "crab"],
    ingredient: ["=게", "꽃게", "대게", "홍게", "털게", "왕게", "게살", "게장", "게추출", "게엑기스", "게분말", "킹크랩", "크랩", "crab"],
    derived: ["게맛", "게향"],
    possible: ["맛살", "해물", "해산물"],
    exclude: ["게르마늄"],
  },
  새우: {
    aliases: ["새우", "쉬림프", "shrimp", "prawn", "대하"],
    ingredient: ["새우", "대하", "쉬림프", "shrimp", "prawn"],
    derived: ["새우젓", "새우엑기스", "새우분말"],
    possible: ["해물", "해산물", "수산물가공", "젓갈", "김치"],
    exclude: [],
  },
  돼지고기: {
    aliases: ["돼지고기", "돼지", "돈육", "pork"],
    ingredient: ["돼지", "돈육", "돈지", "돈골", "돈피", "돈사골", "포크", "pork", "삼겹", "목살", "족발", "항정", "라드"],
    derived: ["베이컨", "햄", "돈까스", "돈가스", "순대"],
    possible: [
      "소시지", "소세지", "비엔나", "프랑크", "스팸", "젤라틴", "콜라겐", "육수", "육류", "육가공",
      "분쇄가공육", "양념육", "식육추출", "식육가공", "포장육", "햄류", "소시지류",
    ],
    exclude: ["돼지감자", "햄버거", "햄버그"],
  },
  쇠고기: {
    aliases: ["쇠고기", "소고기", "우육", "비프", "beef"],
    ingredient: ["쇠고기", "소고기", "우육", "비프", "beef", "소뼈", "우골", "사골", "우족", "=양지", "양지머리", "우지", "소갈비", "소꼬리", "육우", "한우", "곰탕", "설렁탕", "우피"],
    derived: ["비프엑기스", "쇠고기엑기스", "소고기엑기스", "쇠고기추출", "소고기추출"],
    possible: ["젤라틴", "콜라겐", "육수", "육류", "불고기", "갈비", "분쇄가공육", "양념육", "식육추출", "식육가공", "포장육"],
    exclude: [],
  },
  닭고기: {
    aliases: ["닭고기", "닭", "계육", "치킨", "chicken"],
    ingredient: ["닭", "계육", "치킨", "chicken", "계골", "영계", "삼계"],
    derived: ["치킨엑기스", "치킨스톡", "치킨파우더", "닭고기추출"],
    possible: ["육수", "육류", "분쇄가공육", "양념육", "식육추출", "식육가공", "포장육"],
    exclude: [],
  },
  오징어: {
    aliases: ["오징어", "squid"],
    ingredient: ["오징어", "squid", "한치", "진미채", "칼라마리"],
    derived: ["오징어맛", "오징어엑기스", "오징어분말", "오징어먹물"],
    possible: ["해물", "해산물"],
    exclude: [],
  },
  조개류: {
    aliases: ["조개류", "조개", "패류", "shellfish"],
    ingredient: ["조개", "굴", "전복", "홍합", "바지락", "모시조개", "가리비", "꼬막", "백합", "키조개", "재첩", "대합", "맛조개", "새조개", "피조개", "소라", "골뱅이", "패류", "oyster", "clam", "mussel", "scallop"],
    derived: ["굴소스", "굴엑기스", "굴추출", "조개엑기스", "홍합엑기스", "바지락엑기스"],
    possible: ["해물", "해산물", "수산물가공", "젓갈", "김치"],
    exclude: ["굴러", "굴곡", "굴절", "동굴"],
  },
  복숭아: {
    aliases: ["복숭아", "peach"],
    ingredient: ["복숭아", "백도", "황도", "천도", "피치", "peach"],
    derived: [],
    possible: [],
    exclude: [],
  },
  토마토: {
    aliases: ["토마토", "tomato"],
    ingredient: ["토마토", "tomato"],
    derived: ["케찹", "케첩", "리코펜"],
    possible: [],
    exclude: [],
  },
  아황산류: {
    aliases: ["아황산류", "아황산", "이산화황", "sulfite", "sulfites", "sulphite"],
    ingredient: ["아황산", "이산화황", "sulfite", "sulphite"],
    derived: [],
    possible: ["건포도", "건살구", "건조과일", "와인", "포도주"],
    exclude: [],
  },
  호두: {
    aliases: ["호두", "walnut"],
    ingredient: ["호두", "walnut"],
    derived: [],
    possible: [],
    exclude: [],
  },
  잣: {
    aliases: ["잣", "pine nut", "pine nuts"],
    ingredient: ["잣", "pinenut"],
    derived: [],
    possible: [],
    exclude: ["잣나무"],
  },
  // 참깨: 식약처 표시 대상은 아니지만(EU 등에서는 대상) 사용자가 등록하는 경우가 많다
  참깨: {
    aliases: ["참깨", "깨", "sesame", "흑임자", "검은깨"],
    ingredient: ["참깨", "검정깨", "흑임자", "볶음깨", "볶은깨", "통깨", "깨소금", "sesame"],
    derived: ["참기름", "깨즙", "타히니", "깨가루"],
    possible: [],
    exclude: ["들깨"],
  },
  // ── 견과류 구성원 중 표준 19종에 없는 항목 ─────────────────
  아몬드: { aliases: ["아몬드", "almond"], ingredient: ["아몬드", "almond"], derived: [], possible: [], exclude: [] },
  캐슈넛: { aliases: ["캐슈넛", "캐슈", "cashew"], ingredient: ["캐슈", "cashew"], derived: [], possible: [], exclude: [] },
  피칸: { aliases: ["피칸", "pecan"], ingredient: ["피칸", "pecan"], derived: [], possible: [], exclude: [] },
  헤이즐넛: { aliases: ["헤이즐넛", "hazelnut"], ingredient: ["헤이즐넛", "헤이즐", "hazelnut", "누텔라"], derived: [], possible: [], exclude: [] },
  마카다미아: { aliases: ["마카다미아", "macadamia"], ingredient: ["마카다미아", "macadamia"], derived: [], possible: [], exclude: [] },
  피스타치오: { aliases: ["피스타치오", "pistachio"], ingredient: ["피스타치오", "pistachio"], derived: [], possible: [], exclude: [] },
  // ── 갑각류 구성원 ───────────────────────────────────────────
  가재: { aliases: ["가재", "crayfish"], ingredient: ["가재", "crayfish"], derived: [], possible: [], exclude: [] },
  랍스터: { aliases: ["랍스터", "바닷가재", "lobster"], ingredient: ["랍스터", "바닷가재", "lobster"], derived: [], possible: [], exclude: [] },
  크릴: { aliases: ["크릴", "krill"], ingredient: ["크릴", "krill"], derived: [], possible: [], exclude: [] },
  // ── 생선 구성원 ─────────────────────────────────────────────
  연어: { aliases: ["연어", "salmon"], ingredient: ["연어", "salmon"], derived: [], possible: [], exclude: [] },
  참치: { aliases: ["참치", "tuna"], ingredient: ["참치", "다랑어", "가다랑어", "가쓰오", "가츠오", "tuna", "bonito"], derived: [], possible: [], exclude: [] },
  멸치: { aliases: ["멸치", "anchovy"], ingredient: ["멸치", "anchovy"], derived: [], possible: [], exclude: [] },
  명태: { aliases: ["명태", "황태", "북어", "동태", "코다리", "pollock"], ingredient: ["명태", "황태", "북어", "동태", "코다리", "노가리", "pollock"], derived: ["명란"], possible: [], exclude: [] },
  대구: { aliases: ["대구", "cod"], ingredient: ["대구", "cod"], derived: [], possible: [], exclude: [] },
  어류기타: {
    aliases: [],
    ingredient: ["갈치", "삼치", "꽁치", "조기", "병어", "장어", "민어", "광어", "우럭", "도미", "가자미", "붕어", "잉어", "송어", "홍어", "아귀", "청어", "정어리", "전갱이", "임연수", "쥐치", "생선", "어육", "어류", "어묵", "어분", "연육", "수리미", "fish", "피쉬"],
    derived: ["액젓", "어간장", "어포", "카마보코"],
    possible: ["맛살", "수산물가공", "젓갈", "김치"],
    exclude: [],
  },
  // ── 글루텐 구성원(밀 제외) ─────────────────────────────────
  보리: { aliases: ["보리", "barley"], ingredient: ["보리", "대맥", "맥아", "엿기름", "맥주효모", "barley", "malt"], derived: [], possible: [], exclude: ["보리새우", "보리수"] },
  호밀: { aliases: ["호밀", "rye"], ingredient: ["호밀", "라이보리", "rye"], derived: [], possible: [], exclude: [] },
  귀리: { aliases: ["귀리", "오트", "오트밀", "oat", "oats"], ingredient: ["귀리", "오트", "oat"], derived: [], possible: [], exclude: [] },
};

// ─────────────────────────────────────────────────────────────
// 2. 묶음 항목 (사용자가 입력하는 넓은 범주 → 구성원)
// ─────────────────────────────────────────────────────────────
const GROUPS = {
  견과류: {
    aliases: ["견과류", "견과", "너트", "견과가공품", "nuts", "tree nuts", "treenut"],
    members: ["호두", "잣", "아몬드", "캐슈넛", "피칸", "헤이즐넛", "마카다미아", "피스타치오", "땅콩"],
    ingredient: ["견과", "믹스넛", "혼합견과"],
    possible: ["=밤", "밤가루", "밤페이스트", "밤분말", "군밤"],
    exclude: [],
  },
  갑각류: {
    aliases: ["갑각류", "crustacean", "crustaceans"],
    members: ["새우", "게", "가재", "랍스터", "크릴"],
    ingredient: ["갑각류", "갑각", "crustacean"],
    exclude: [],
  },
  생선: {
    aliases: ["생선", "어류", "fish", "물고기"],
    members: ["고등어", "연어", "참치", "멸치", "명태", "대구", "어류기타"],
    ingredient: [],
    exclude: [],
  },
  글루텐: {
    aliases: ["글루텐", "gluten", "글루텐불내증", "셀리악"],
    members: ["밀", "보리", "호밀", "귀리"],
    ingredient: ["글루텐", "gluten"],
    exclude: [],
  },
};

// 표준 항목 이름(식약처 표시기준) — 라벨의 "함유" 문구를 이 이름으로 정규화한다.
const OFFICIAL_ALLERGENS = [
  "우유", "계란", "메밀", "땅콩", "대두", "밀", "고등어", "게", "새우", "돼지고기",
  "복숭아", "토마토", "아황산류", "호두", "닭고기", "쇠고기", "오징어", "조개류", "잣",
];

// 사용자가 프로필에서 고를 수 있는 항목(화면 노출 순서). 묶음 + 표준 19종.
const SELECTABLE_ALLERGENS = [
  "우유", "계란", "땅콩", "견과류", "대두", "밀", "글루텐", "갑각류", "생선", "메밀",
  "새우", "게", "조개류", "고등어", "오징어", "돼지고기", "쇠고기", "닭고기",
  "복숭아", "토마토", "아황산류", "호두", "잣", "참깨",
];

// ─────────────────────────────────────────────────────────────
// 3. 표기 정규화
// ─────────────────────────────────────────────────────────────
function normalizeText(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s ·ㆍ•*※]+/g, "")
    .replace(/[“”"'‘’`]/g, "");
}

// 별칭 → 표준 이름 사전 (모든 aliases 와 항목명을 정규화해서 등록)
const ALIAS_INDEX = (() => {
  const idx = new Map();
  const put = (alias, canonical) => {
    const k = normalizeText(alias);
    if (k && !idx.has(k)) idx.set(k, canonical);
  };
  for (const [name, def] of Object.entries(ALLERGENS)) {
    put(name, name);
    for (const a of def.aliases || []) put(a, name);
  }
  for (const [name, def] of Object.entries(GROUPS)) {
    put(name, name);
    for (const a of def.aliases || []) put(a, name);
  }
  // 라벨에서 자주 보이는 표기
  put("소고기", "쇠고기");
  put("알류(가금류)", "계란");
  put("알류(가금류만해당)", "계란");
  put("이산화황", "아황산류");
  put("굴", "조개류");
  put("전복", "조개류");
  put("홍합", "조개류");
  put("바지락", "조개류");
  return idx;
})();

/**
 * 라벨/사용자 입력의 알레르기 표기를 표준 이름으로 정규화한다.
 *   "조개류(굴·홍합 포함)" → "조개류",  "알류(달걀)" → "계란",  "돼지 고기" → "돼지고기"
 * 사전에 없으면 입력(괄호 제거 후)을 그대로 쓴다.
 * @returns {string}
 */
function canonicalizeAllergen(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const direct = ALIAS_INDEX.get(normalizeText(raw));
  if (direct) return direct;

  // 괄호 앞부분이 사전에 있으면 그것을 사용: "조개류(굴)" → "조개류"
  const head = raw.split(/[(（\[]/)[0];
  const headHit = ALIAS_INDEX.get(normalizeText(head));
  if (headHit) return headHit;

  // 괄호 안 값: "알류(계란)" 처럼 앞이 일반명이고 안쪽이 구체명일 때 안쪽도 확인
  const inner = raw.match(/[(（\[]([^)）\]]+)[)）\]]/);
  if (inner) {
    const innerHit = ALIAS_INDEX.get(normalizeText(inner[1].split(/[·,/]/)[0]));
    if (innerHit) return innerHit;
  }
  return head.trim() || raw;
}

/** 묶음 항목이면 구성원 표준 이름 배열, 아니면 null */
function groupMembers(canonical) {
  return GROUPS[canonical] ? GROUPS[canonical].members.slice() : null;
}

/**
 * 사용자 알레르기 항목 하나가 커버하는 표준 항목 목록(자기 자신 + 구성원).
 * 예: "견과류" → ["견과류","호두","잣","아몬드",...,"땅콩"]
 */
function expandAllergen(name) {
  const canonical = canonicalizeAllergen(name);
  const out = [canonical];
  for (const m of groupMembers(canonical) || []) {
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * 표준 항목(또는 묶음)의 키워드 사전을 레벨별로 반환한다. 묶음은 구성원 사전을 합친다.
 * 값은 normalizeText 를 거친 문자열이며, "=" 로 시작하면 정확 일치 전용이다.
 */
function termsFor(canonical) {
  const result = { ingredient: [], derived: [], possible: [], exclude: [] };
  const add = (def) => {
    if (!def) return;
    for (const lv of ["ingredient", "derived", "possible", "exclude"]) {
      for (const t of def[lv] || []) {
        const exact = t.startsWith("=");
        const n = normalizeText(exact ? t.slice(1) : t);
        if (!n) continue;
        const key = exact ? `=${n}` : n;
        if (!result[lv].includes(key)) result[lv].push(key);
      }
    }
  };
  if (GROUPS[canonical]) {
    add(GROUPS[canonical]);
    for (const m of GROUPS[canonical].members) add(ALLERGENS[m]);
  } else if (ALLERGENS[canonical]) {
    add(ALLERGENS[canonical]);
  } else {
    // 사전에 없는 사용자 입력: 입력값 자체를 원재료 키워드로 사용
    const n = normalizeText(canonical);
    if (n) result.ingredient.push(n);
  }
  return result;
}

module.exports = {
  ALLERGENS,
  GROUPS,
  OFFICIAL_ALLERGENS,
  SELECTABLE_ALLERGENS,
  normalizeText,
  canonicalizeAllergen,
  expandAllergen,
  groupMembers,
  termsFor,
};
