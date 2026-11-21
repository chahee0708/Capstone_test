// 실행: node --test test/   (backend 폴더에서)
const test = require("node:test");
const assert = require("node:assert");
const { findAllergensInIngredients: find } = require("../services/ingredientAllergenService");

test("원재료 이름과 괄호 안에서 알레르기 성분을 찾는다", () => {
  assert.deepStrictEqual(find(["밀가루", "콩기름(대두유)", "탈지분유", "전란액"]), ["계란", "우유", "대두", "밀"]);
  assert.deepStrictEqual(find(["식물성크림[팜핵경화유, 혼합제제(카제인나트륨)]"]), ["우유"]);
  assert.deepStrictEqual(find(["굴농축액", "새우젓", "돼지고기"]), ["새우", "돼지고기", "조개류"]);
});

test("비슷한 글자와 향료는 알레르기로 보지 않는다", () => {
  assert.deepStrictEqual(
    find([
      "밀크향", "호밀분말", "약모밀추출분말", "밀감", "둥굴레추출액", "난소화성말토덱스트린",
      "코코아버터", "땅콩버터향", "식물성크림", "강낭콩", "돼지감자", "복숭아향", "게향",
      "땅콩 또는 견과류가공품", "나무토마토열매",
    ]),
    [],
  );
});
