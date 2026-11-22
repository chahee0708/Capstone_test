/**
 * allergenMap.test.js
 *
 * 역할: 알레르기 목록 테스트
 *   - backend/services/allergenMap.js 와 data_pipeline/clean_foods.py 의 목록이 같은지
 *     (파이썬 파일을 글자로 읽어 비교. 도커 백엔드 컨테이너처럼 파이썬 파일이 없으면 건너뛴다)
 *   - 표기 통일, 미완료 조건
 * 이번 변경: 새 파일
 * 실행: backend 폴더에서 node --test test/allergenMap.test.js
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const allergenMap = require("../services/allergenMap");
const {
  matchLabelAllergens,
  findIngredientAllergens,
  isAllergyCheckIncomplete,
} = require("../services/labelAllergyService");

const PY_PATH = path.join(__dirname, "../../data_pipeline/clean_foods.py");

/** 파이썬 dict 글자 → { 키: 값 } (값이 None 이면 null) */
function readPythonDict(source, name) {
  const start = source.indexOf(`${name} = {`);
  assert.ok(start >= 0, `${name} 를 clean_foods.py 에서 찾지 못함`);
  const body = source.slice(start, source.indexOf("}", start));
  const result = {};
  for (const [, key, value] of body.matchAll(/"([^"]+)"\s*:\s*(?:"([^"]+)"|None)/g)) {
    result[key] = value ?? null;
  }
  return result;
}

test("allergenMap.js 와 clean_foods.py 의 목록이 같다", { skip: !fs.existsSync(PY_PATH) }, () => {
  const source = fs.readFileSync(PY_PATH, "utf8");
  assert.deepStrictEqual(allergenMap.ALLERGEN_MAP, readPythonDict(source, "ALLERGEN_MAP"));
  assert.deepStrictEqual(allergenMap.ALLERGEN_PREFIX_MAP, readPythonDict(source, "ALLERGEN_PREFIX_MAP"));
  assert.deepStrictEqual(allergenMap.ALLERGEN_GROUPS, readPythonDict(source, "ALLERGEN_GROUPS"));
});

test("표기 통일: 띄어쓰기·괄호·별칭", () => {
  const u = allergenMap.toUnifiedAllergen;
  assert.strictEqual(u("돼지 고기"), "돼지고기");
  assert.strictEqual(u("알류(달걀)"), "계란");
  assert.strictEqual(u("조개류(굴, 홍합)"), "조개류");
  assert.strictEqual(u("소고기"), "쇠고기");
  assert.strictEqual(u("이거품은메밀"), null);
  assert.strictEqual(u("d-토코페롤(혼합형)"), null); // 알레르기 성분 아님
});

test("사용자 알레르기 비교: 이름과 그룹 (기존 결과와 같음)", () => {
  assert.deepStrictEqual(matchLabelAllergens(["우유", "돼지고기"], ["우유"]), ["우유"]);
  assert.deepStrictEqual(matchLabelAllergens(["새우"], ["갑각류"]), ["갑각류(새우)"]);
  assert.deepStrictEqual(matchLabelAllergens(["달걀"], ["계란"]), ["계란"]);
  assert.deepStrictEqual(matchLabelAllergens(["산양유"], ["우유"]), ["우유(산양유)"]);
});

test("원재료 키워드: 파생 원재료를 알레르기로 연결한다", () => {
  const a = allergenMap.allergensInIngredient;
  assert.deepStrictEqual(a("유크림"), ["우유"]);
  assert.deepStrictEqual(a("탈지분유"), ["우유"]);
  assert.deepStrictEqual(a("간장").sort(), ["대두", "밀"]);
  assert.deepStrictEqual(a("치킨향분말"), ["닭고기"]);
  assert.deepStrictEqual(a("밀"), ["밀"]);
  assert.deepStrictEqual(a("콩"), ["대두"]);
});

test("원재료 키워드: 오탐 방지 (메밀·호밀·밀감·강낭콩·젤라틴)", () => {
  const a = allergenMap.allergensInIngredient;
  assert.deepStrictEqual(a("메밀가루"), ["메밀"]);
  assert.deepStrictEqual(a("호밀가루"), []);
  assert.deepStrictEqual(a("밀감"), []);
  assert.deepStrictEqual(a("강낭콩"), []);
  assert.deepStrictEqual(a("젤라틴"), []); // 원료 동물을 알 수 없어 연결하지 않음
});

test("원재료로 사용자 알레르기 찾기 (마이구미 원재료)", () => {
  const ingredients = ["물엿", "백설탕", "젤라틴", "콜라겐", "합성향료(포도향)", "유크림", "기타식용유지가공품"];
  assert.deepStrictEqual(findIngredientAllergens(ingredients, ["우유"]), [
    { allergen: "우유", ingredient: "유크림" },
  ]);
  assert.deepStrictEqual(findIngredientAllergens(["새우분말"], ["갑각류"]), [
    { allergen: "갑각류(새우)", ingredient: "새우분말" },
  ]);
  assert.deepStrictEqual(findIngredientAllergens(ingredients, ["땅콩"]), []);
});

test("미완료 조건: 함유 문구 없음, 목록에 없는 이름만", () => {
  assert.strictEqual(isAllergyCheckIncomplete([], []), true);
  assert.strictEqual(isAllergyCheckIncomplete(["우유"], ["이거품은메밀"]), true);
  assert.strictEqual(isAllergyCheckIncomplete(["기"], []), true);
  assert.strictEqual(isAllergyCheckIncomplete(["우유", "돼지고기"], ["복숭아"]), false);
});
