/**
 * labelCategory.js
 *
 * 역할: 사진(라벨)에서 읽은 식품유형 + 제품명 → 통합 중분류 (Food.unified_mid 와 같은 이름)
 *   식품명 검색 결과처럼 사진 결과에도 카테고리(그림, 내 식품 목록의 분류)를 붙이기 위해 쓴다.
 *
 * 쓰이는 곳: backend/routes/recommend.js (POST /recommend/label)
 *
 * 규칙: data_pipeline/clean/category_map.csv 를 라벨 식품유형(식품공전 이름)에 맞게 옮긴 것
 *   - 위에서부터 식품유형이 맞는 첫 줄을 쓴다
 *   - 그 줄의 이름 규칙(names)을 순서대로 보고, 맞는 게 없으면 기본 중분류(mid)
 *   - 식품유형을 못 읽었거나 어느 줄에도 안 맞으면 null (이름만으로 추측하지 않는다:
 *     "솔티카라멜생크림빵" 은 이름만 보면 "카라멜" 때문에 사탕으로 잘못 분류된다)
 *   중분류 이름은 category_map.csv 의 unified_mid 와 글자까지 같아야 한다 (frontend categoryIcons.ts 도 같은 이름)
 *
 * 예) labelCategory("빵류", "연세우유 솔티카라멜생크림빵") → "간식빵"
 *     labelCategory("과자", "초코파이") → "과자"
 */

const FOOD_TYPE_RULES = [
  {
    type: /빵류/,
    names: [
      [/피자|핫도그|버거/, "피자·버거"],
      [/식빵|모닝빵|베이글|바게트|치아바타|깜빠뉴|캄파뉴|토스트/, "식빵·모닝빵"],
      [/케이크|케익|롤케|카스테라|마카롱|타르트|티라미수|무스|브라우니|머핀|스콘|와플|팬케이크|크로플|슈크림|에클레어|마들렌|휘낭시에|도라야끼/, "케이크·디저트"],
    ],
    mid: "간식빵",
  },
  { type: /떡류/, names: [[/떡볶이/, "떡볶이·분식"]], mid: "떡·한과" },
  { type: /캔디류|추잉껌|껌/, names: [], mid: "사탕·캔디" },
  { type: /엿/, names: [[/호박엿|판엿|엿강정/, "사탕·캔디"]], mid: "당류·시럽" },
  {
    type: /과자/,
    names: [
      [/젤리|구미|마시멜로/, "젤리"],
      [/케이크|케익|마카롱|타르트|머핀|마들렌/, "케이크·디저트"],
    ],
    mid: "과자",
  },
  {
    type: /초콜릿|쵸콜릿|코코아/,
    names: [
      [/초코파이/, "과자"],
      [/핫초코|핫쵸코|코코아|쉐이크|믹스|파우더/, "곡물·분말음료"],
    ],
    mid: "초콜릿",
  },
  { type: /아이스크림|아이스밀크|샤베트|빙과|빙수/, names: [], mid: "아이스크림" },
  { type: /젤리/, names: [], mid: "젤리" },
  { type: /탄산/, names: [], mid: "탄산음료" },
  { type: /과[·.\s]?채|과일|채소|야채/, names: [], mid: "과일·야채음료" },
  { type: /커피/, names: [], mid: "커피" },
  { type: /인삼|홍삼/, names: [], mid: "홍삼·건강음료" },
  { type: /다류|침출차|액상차|고형차/, names: [], mid: "차·전통음료" },
  { type: /두유/, names: [], mid: "두유" },
  { type: /발효유|요구르트|요거트|유산균/, names: [], mid: "요거트·요구르트" },
  { type: /치즈/, names: [], mid: "치즈" },
  { type: /우유|가공유|유당분해/, names: [], mid: "우유" },
  {
    type: /혼합음료|음료베이스|기타음료|이온음료|음료/,
    names: [
      [/이온|스포츠|포도당|전해질/, "스포츠음료"],
      [/에이드|주스|스무디/, "과일·야채음료"],
      [/식혜|수정과|아이스티|녹차|홍차|말차/, "차·전통음료"],
      [/프로틴|단백질|아미노|콜라겐/, "홍삼·건강음료"],
    ],
    mid: "기타음료",
  },
  { type: /유탕면|라면/, names: [], mid: "라면" },
  { type: /국수|냉면|당면|파스타|면류|건면|생면|숙면/, names: [[/라면|컵|볶음면|짬뽕/, "라면"]], mid: "국수·면" },
  { type: /잼|스프레드|땅콩버터/, names: [], mid: "잼·스프레드" },
  { type: /시리얼/, names: [], mid: "시리얼" },
  { type: /땅콩|견과/, names: [[/버터|스프레드/, "잼·스프레드"]], mid: "견과류" },
  { type: /만두/, names: [], mid: "만두" },
  { type: /소시지|햄|베이컨|양념육|식육/, names: [], mid: "햄·가공육" },
  { type: /어묵|맛살|어육/, names: [[/소시지|소세지|햄/, "햄·가공육"]], mid: "어묵·맛살" },
  { type: /김치/, names: [], mid: "김치" },
  { type: /절임|장아찌/, names: [], mid: "절임·장아찌" },
  { type: /두부|묵/, names: [], mid: "두부·묵" },
  { type: /고추장/, names: [], mid: "고추장" },
  { type: /된장|청국장/, names: [], mid: "된장" },
  { type: /간장/, names: [], mid: "간장" },
  { type: /춘장|혼합장|쌈장/, names: [], mid: "쌈장·혼합장" },
  { type: /마요네즈/, names: [], mid: "마요네즈" },
  { type: /케첩|케찹/, names: [], mid: "토마토케첩" },
  { type: /소스|드레싱/, names: [], mid: "소스" },
  { type: /식초/, names: [], mid: "식초" },
  { type: /즉석|편의식품|간편조리/, names: [
      [/샐러드|샌드위치|또띠아|브리또|부리또/, "샐러드·샌드위치"],
      [/피자|버거|핫도그/, "피자·버거"],
      [/떡볶이|순대|튀김|어묵|오뎅/, "떡볶이·분식"],
      [/국수|면|우동|파스타|스파게티|냉면/, "국수·면"],
      [/도시락|김밥|덮밥|볶음밥|비빔밥|주먹밥|컵밥|즉석밥|죽/, "밥·도시락·죽"],
      [/탕|찌개|전골|스프|수프|국$/, "국·탕·찌개"],
    ],
    mid: "기타 간편식",
  },
];

function labelCategory(foodType, productName = "") {
  const type = String(foodType || "").replace(/\s+/g, "");
  if (!type) return null;
  const rule = FOOD_TYPE_RULES.find((r) => r.type.test(type));
  if (!rule) return null;
  const name = String(productName || "");
  const hit = rule.names.find(([pattern]) => pattern.test(name));
  return hit ? hit[1] : rule.mid;
}

module.exports = { labelCategory };
