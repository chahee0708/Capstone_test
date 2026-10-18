const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseIngredients,
  parseAllergenStatement,
  detectAllergens,
  matchUserAllergens,
  findOpaqueIngredients,
} = require("../services/allergenMatcher");
const { canonicalizeAllergen, expandAllergen } = require("../services/allergenKnowledge");
const { checkAllergens, analyzeIngredientText } = require("../services/allergyService");

const match = (ingredientsText, userAllergens, extra = {}) =>
  matchUserAllergens({ ingredientsText, userAllergens, ...extra });

// ── 핵심 요구: 원재료명에 "크림"이 있으면 우유 알레르기와 연결 ───────────────

test("크림 → 우유 알레르기와 연결된다", () => {
  const r = match("정제수, 크림, 설탕", ["우유"]);
  assert.equal(r.length, 1);
  assert.equal(r[0].allergen, "우유");
  assert.equal(r[0].severity, "contains");
  assert.equal(r[0].level, "derived");
  assert.equal(r[0].evidence[0].ingredient, "크림");
  assert.equal(r[0].evidence[0].keyword, "크림");
});

test("크림이 들어간 다양한 표기도 우유와 연결된다", () => {
  for (const ing of ["생크림", "휘핑크림", "크림치즈", "사워크림", "크림소스", "버터크림", "크림분말", "커피크림", "크림(국산)", "유크림(호주산)"]) {
    const r = match(`정제수, ${ing}`, ["우유"]);
    assert.equal(r.length, 1, `${ing} 가 우유로 연결되어야 함`);
    assert.equal(r[0].severity, "contains");
  }
});

test("아이스크림·슈크림 같은 크림 포함 제품명도 우유로 연결된다", () => {
  assert.equal(match("바닐라아이스크림, 설탕", ["우유"]).length, 1);
  assert.equal(match("슈크림, 밀가루", ["우유"]).length, 1);
});

test("코코넛크림은 우유가 아니다 (오탐 방지)", () => {
  assert.deepEqual(match("코코넛크림, 설탕", ["우유"]), []);
});

test("식물성크림은 확정이 아니라 '가능성'으로 표시된다 (카제인 함유 가능)", () => {
  const r = match("식물성크림(팜경화유), 설탕", ["우유"]);
  assert.equal(r.length, 1);
  assert.equal(r[0].level, "possible");
  assert.equal(r[0].severity, "may_contain");
});

test("향미 제제(크림향, 치킨향)는 확정이 아니라 가능성이다", () => {
  const cream = match("딸기크림향, 설탕", ["우유"]);
  assert.equal(cream[0].level, "possible");
  const chicken = match("치킨향분말, 정제소금", ["닭고기"]);
  assert.equal(chicken[0].level, "possible");
});

test("유제품 파생 원료들이 우유로 연결된다", () => {
  for (const ing of ["버터", "치즈분말", "탈지분유", "유청단백", "카제인나트륨", "유당", "연유", "요거트파우더", "락토페린", "모짜렐라치즈"]) {
    assert.equal(match(`정제수, ${ing}`, ["우유"]).length, 1, ing);
  }
});

test("락토바실러스(유산균)는 우유가 아니다, 카카오버터·땅콩버터도 아니다", () => {
  assert.deepEqual(match("락토바실러스카제이, 설탕", ["우유"]), []);
  assert.deepEqual(match("카카오버터, 코코아분말", ["우유"]), []);
  assert.deepEqual(match("땅콩버터", ["우유"]), []);
});

// ── 다른 알레르기 파생 관계 ────────────────────────────────────────

test("계란: 전란액/난백/마요네즈/난각칼슘", () => {
  for (const ing of ["전란액", "난백분말", "마요네즈", "난각칼슘", "달걀흰자", "메추리알"]) {
    assert.equal(match(`정제수, ${ing}`, ["계란"]).length, 1, ing);
  }
  // 사용자가 '달걀' / '알류' 로 등록해도 같은 항목
  assert.equal(match("마요네즈", ["달걀"]).length, 1);
  assert.equal(match("마요네즈", ["알류"]).length, 1);
});

test("밀: 밀가루/소맥분/빵가루/튀김가루, 메밀·밀크는 제외", () => {
  for (const ing of ["밀가루(밀:미국산)", "소맥분", "빵가루", "튀김가루", "통밀", "글루텐"]) {
    assert.equal(match(`정제수, ${ing}`, ["밀"]).length, 1, ing);
  }
  assert.deepEqual(match("메밀가루", ["밀"]), []);
  assert.deepEqual(match("밀크초콜릿", ["밀"]), []);
  assert.equal(match("밀크초콜릿", ["우유"]).length, 1);
  assert.deepEqual(match("α-아밀라아제", ["밀"]), []);
});

test("대두: 간장/된장/레시틴/두부, 로커스트콩검·완두콩은 제외", () => {
  for (const ing of ["양조간장", "된장", "대두레시틴", "두부", "콩기름", "탈지대두"]) {
    assert.equal(match(`정제수, ${ing}`, ["대두"]).length, 1, ing);
  }
  assert.deepEqual(match("로커스트콩검, 구아검", ["대두"]), []);
  assert.deepEqual(match("완두콩", ["대두"]), []);
});

test("묶음 항목: 견과류/갑각류/생선/글루텐", () => {
  assert.equal(match("아몬드분태", ["견과류"]).length, 1);
  assert.equal(match("호두", ["견과류"]).length, 1);
  assert.equal(match("땅콩", ["견과류"]).length, 1);
  assert.equal(match("새우젓", ["갑각류"]).length, 1);
  assert.equal(match("꽃게", ["갑각류"]).length, 1);
  assert.equal(match("멸치액젓", ["생선"]).length, 1);
  assert.equal(match("참치캔", ["생선"]).length, 1);
  assert.equal(match("보리맥아", ["글루텐"]).length, 1);
  assert.equal(match("밀가루", ["글루텐"]).length, 1);
  // 보리새우는 새우(갑각류)지 보리(글루텐)가 아니다
  assert.deepEqual(match("보리새우", ["글루텐"]), []);
  assert.equal(match("보리새우", ["갑각류"]).length, 1);
});

test("돼지고기/쇠고기/닭고기: 파생 원료", () => {
  assert.equal(match("베이컨, 정제수", ["돼지고기"]).length, 1);
  assert.equal(match("라드", ["돼지고기"]).length, 1);
  assert.equal(match("사골엑기스", ["쇠고기"]).length, 1);
  assert.equal(match("비프스톡분말", ["쇠고기"]).length, 1);
  assert.equal(match("닭가슴살(국산)", ["닭고기"]).length, 1);
  // 돼지감자는 돼지고기가 아니다
  assert.deepEqual(match("돼지감자분말", ["돼지고기"]), []);
  // 젤라틴은 확정이 아니라 가능성
  assert.equal(match("젤라틴", ["돼지고기"])[0].level, "possible");
});

test("게는 한 글자 이름이므로 정확 일치/관련어만 인정 (게르마늄 오탐 방지)", () => {
  assert.equal(match("꽃게, 정제수", ["게"]).length, 1);
  assert.equal(match("게(국산)", ["게"]).length, 1);
  assert.deepEqual(match("게르마늄", ["게"]), []);
});

test("조개류/오징어/새우/복숭아/토마토/아황산류/메밀", () => {
  assert.equal(match("굴소스", ["조개류"]).length, 1);
  assert.equal(match("바지락엑기스", ["조개류"]).length, 1);
  assert.equal(match("오징어먹물", ["오징어"]).length, 1);
  assert.equal(match("건새우", ["새우"]).length, 1);
  assert.equal(match("백도농축액", ["복숭아"]).length, 1);
  assert.equal(match("케찹", ["토마토"]).length, 1);
  assert.equal(match("메타중아황산나트륨", ["아황산류"]).length, 1);
  assert.equal(match("메밀가루", ["메밀"]).length, 1);
});

// ── 원재료명 파싱 ────────────────────────────────────────────────

test("괄호 중첩/원산지 표기를 풀어 하위 원료까지 검사한다", () => {
  const names = parseIngredients("혼합제제(대두레시틴, 팜유), 밀가루(밀:미국산,호주산), 쇼트닝[팜유(말레이시아산)]").map((s) => s.name);
  assert.ok(names.includes("혼합제제"));
  assert.ok(names.includes("대두레시틴"));
  assert.ok(names.includes("밀가루"));
  assert.ok(names.includes("밀"));
  assert.ok(names.includes("팜유"));
  assert.ok(!names.some((n) => n.includes("미국산")));
  // 하위 항목에 숨은 알레르기도 찾는다
  assert.equal(match("혼합제제(대두레시틴, 팜유)", ["대두"]).length, 1);
});

test("쉼표가 없는 OCR 텍스트(띄어쓰기/구분 누락)에서도 부분 일치로 찾는다", () => {
  const r = match("혼합분유딸기잼버터혼합식용유기타과당", ["우유"]);
  assert.equal(r.length, 1);
});

test("공백/전각/대소문자 차이를 무시한다", () => {
  assert.equal(match("탈지 분유", ["우유"]).length, 1);
  assert.equal(match("MILK POWDER", ["우유"]).length, 1);
});

// ── 표시 문구(함유/혼입) 해석 ──────────────────────────────────────

test("'○○ 함유' 표시 문구에서 알레르기 항목을 추출한다", () => {
  const s = parseAllergenStatement("원재료명 정제수,설탕,안나토색소\n밀,땅콩,대두,우유 함유 제조일 측면 표기");
  assert.deepEqual(s.declared.sort(), ["대두", "땅콩", "밀", "우유"]);
  assert.deepEqual(s.cross, []);
  assert.ok(!s.remaining.includes("함유"));
});

test("'같은 제조시설' 문구는 함유가 아니라 혼입 가능(cross)으로 분류한다", () => {
  const s = parseAllergenStatement("이 제품은 메밀, 땅콩을 사용한 제품과 같은 제조시설에서 제조하고 있습니다.");
  assert.deepEqual(s.declared, []);
  assert.deepEqual(s.cross.sort(), ["땅콩", "메밀"]);
});

test("조개류(굴·홍합 포함)/알류(달걀) 같은 표기를 표준 이름으로 정규화한다", () => {
  assert.equal(canonicalizeAllergen("조개류(굴·홍합 포함)"), "조개류");
  assert.equal(canonicalizeAllergen("알류(달걀)"), "계란");
  assert.equal(canonicalizeAllergen("돼지 고기"), "돼지고기");
  assert.equal(canonicalizeAllergen("소고기"), "쇠고기");
  assert.equal(canonicalizeAllergen("이산화황"), "아황산류");
  assert.deepEqual(expandAllergen("견과류").slice(0, 3), ["견과류", "호두", "잣"]);
});

test("표시 문구가 있으면 원재료에 이름이 없어도 사용자 알레르기와 연결된다", () => {
  const r = match("정제수, 복합조미식품, 혼합제제", ["우유", "밀"], { declared: ["우유"] });
  assert.equal(r.length, 1);
  assert.equal(r[0].allergen, "우유");
  assert.equal(r[0].level, "declared");
  assert.equal(r[0].severity, "contains");
});

test("혼입 가능 표시는 may_contain 으로만 표시된다", () => {
  const r = match("정제수, 설탕", ["땅콩"], { cross: ["땅콩"] });
  assert.equal(r.length, 1);
  assert.equal(r[0].level, "cross");
  assert.equal(r[0].severity, "may_contain");
});

test("원재료 목록에 섞인 혼입 문구가 원재료 확정으로 오인되지 않는다", () => {
  const text = "정제수, 설탕, 코코아분말\n땅콩, 호두를 사용한 제품과 같은 제조시설에서 제조";
  const r = match(text, ["땅콩"]);
  assert.equal(r.length, 1);
  assert.equal(r[0].level, "cross");
});

test("세부 성분이 가려진 복합 원료를 알려 준다", () => {
  const opaque = findOpaqueIngredients("정제수, 복합조미식품, 혼합제제(구아검), 설탕");
  assert.ok(opaque.includes("복합조미식품"));
  assert.ok(opaque.includes("혼합제제"));
  assert.deepEqual(findOpaqueIngredients("정제수, 설탕, 소금"), []);
});

test("detectAllergens: 제품 전체에서 확인되는 항목을 반환한다", () => {
  const found = detectAllergens("밀가루(밀:미국산), 생크림, 마요네즈, 새우젓");
  assert.ok(found["밀"] && found["우유"] && found["계란"] && found["새우"]);
  assert.equal(found["우유"].level, "derived");
});

test("analyzeIngredientText: 알레르기 미등록이면 checked=false", () => {
  assert.equal(analyzeIngredientText({ ingredientsText: "크림", userAllergens: [] }).checked, false);
  const r = analyzeIngredientText({ ingredientsText: "생크림, 복합조미식품", userAllergens: ["우유"] });
  assert.equal(r.checked, true);
  assert.deepEqual(r.names, ["우유"]);
  assert.deepEqual(r.opaque, ["복합조미식품"]);
});

test("checkAllergens(하위 호환): 원재료 조회 결과와 사용자 알레르기를 비교한다", async () => {
  const session = {
    run: async (query, params) => {
      assert.equal(params.key, "라면");
      assert.match(query, /HAS_INGREDIENT/);
      return { records: [{ get: () => "밀가루(밀:미국산)" }, { get: () => "팜유" }, { get: () => "생크림분말" }] };
    },
  };
  assert.deepEqual(await checkAllergens(session, "라면", ["밀", "우유", "땅콩"]), ["밀", "우유"]);
  // 알레르기가 없으면 DB 조회 없이 빈 배열
  const never = { run: async () => { throw new Error("호출되면 안 됨"); } };
  assert.deepEqual(await checkAllergens(never, "라면", []), []);
});

// ── 식품 DB 의 "품목제조보고" 수준 원재료 표기 ─────────────────────────

test("식품 DB 표기: 유탕면 → 밀, 유함유가공품 → 우유, 알가열제품 → 계란, 참기름 → 참깨", () => {
  // 진라면(매운맛)의 실제 원재료 항목: 밀가루가 아니라 면의 종류만 적혀 있다
  const ramen = match("유탕면, 복합조미식품, 과.채가공품", ["밀"]);
  assert.equal(ramen.length, 1);
  assert.equal(ramen[0].severity, "contains");
  assert.equal(ramen[0].evidence[0].ingredient, "유탕면");

  assert.equal(match("유함유가공품", ["우유"])[0].severity, "contains");
  assert.equal(match("알가열제품, 정제수", ["계란"])[0].severity, "contains");
  assert.equal(match("참기름, 정제소금", ["참깨"])[0].level, "derived");
  assert.deepEqual(match("들깨가루", ["참깨"]), []);

  // 두류가공품은 대두인지 알 수 없으므로 가능성 수준
  assert.equal(match("두류가공품", ["대두"])[0].severity, "may_contain");
  // 당면(고구마 전분)·쌀국수는 밀이 아니다
  assert.deepEqual(match("당면, 쌀국수", ["밀"]), []);
});

test("김치/젓갈/수산물가공품은 새우·생선·조개류 '가능성'으로만 표시된다", () => {
  for (const a of ["새우", "생선", "조개류"]) {
    const r = match("배추김치", [a]);
    assert.equal(r.length, 1, a);
    assert.equal(r[0].severity, "may_contain", a);
  }
});

test("세부 성분이 가려진 식품 DB 표기(소스·유탕면 외 복합원료)를 불투명 원료로 알려 준다", () => {
  assert.deepEqual(findOpaqueIngredients("유탕면, 복합조미식품, 과.채가공품"), ["복합조미식품", "과.채가공품"]);
  assert.ok(findOpaqueIngredients("정제수, 소스").includes("소스"));
});

// ── 실제 제품 라벨(정답 데이터) 회귀 테스트 ───────────────────────────

test("실제 라벨 351건: 정확도 기준선 유지 (재현율·과잉 경고)", () => {
  const file = path.join(__dirname, "fixtures", "label_samples.json");
  const samples = JSON.parse(fs.readFileSync(file, "utf8"));
  const OFFICIAL = ["우유", "계란", "메밀", "땅콩", "대두", "밀", "고등어", "게", "새우", "돼지고기",
    "복숭아", "토마토", "아황산류", "호두", "닭고기", "쇠고기", "오징어", "조개류", "잣"];

  let declared = 0;
  let found = 0;
  let falseConfirmed = 0;
  let products = 0;
  let coveredOrFlagged = 0;
  for (const s of samples) {
    const decl = new Set((s.allergy || []).map(canonicalizeAllergen).filter((a) => OFFICIAL.includes(a)));
    if (decl.size === 0) continue;
    products += 1;
    const det = detectAllergens(s.ingredients);
    let missed = 0;
    for (const a of OFFICIAL) {
      const f = det[a];
      if (decl.has(a)) {
        declared += 1;
        if (f) found += 1;
        else missed += 1;
      } else if (f && ["ingredient", "derived"].includes(f.level)) {
        falseConfirmed += 1;
      }
    }
    if (missed === 0 || findOpaqueIngredients(s.ingredients).length > 0) coveredOrFlagged += 1;
  }
  const recall = found / declared;
  const covered = coveredOrFlagged / products;
  // 표시 문구를 알 수 없는(원재료만 있는) 상황에서의 기준선. 값이 내려가면 사전이 퇴보한 것이다.
  assert.ok(recall >= 0.74, `재현율 ${(recall * 100).toFixed(1)}% (기준 74%)`);
  assert.ok(covered >= 0.88, `검출 또는 불투명 원료 경고로 커버된 제품 ${(covered * 100).toFixed(1)}% (기준 88%)`);
  assert.ok(falseConfirmed <= 25, `과잉 확정 ${falseConfirmed}건 (기준 25건 이하)`);
});
