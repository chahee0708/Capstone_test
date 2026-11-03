/**
 * labelParser.test.js
 *
 * 역할: 라벨 파서 테스트. 실제 CLOVA 응답 저장본으로 정답을 비교한다 (API 호출 없음)
 * 이번 변경: 새 파일
 * 실행: backend 폴더에서 node --test test/labelParser.test.js
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { parseLabel, toPer100 } = require("../services/labelParser");

const sample = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ocr_samples/label_sample_clova.json"), "utf8"),
);
const result = parseLabel(sample.images[0].fields);

// 합성 라벨: 한 항목이 한 줄. 좌표는 위에서 아래로 쌓는다
function fieldsFrom(lines) {
  return lines.map((text, i) => ({
    inferText: text,
    lineBreak: true,
    boundingPoly: {
      vertices: [
        { x: 10, y: i * 40 },
        { x: 300, y: i * 40 },
        { x: 300, y: i * 40 + 30 },
        { x: 10, y: i * 40 + 30 },
      ],
    },
  }));
}

// 합성 OCR 글자 조각: 실제 CLOVA 처럼 낱말마다 조각을 만들고 줄 끝에 lineBreak 를 넣는다
function fragmentsFrom(lines) {
  return lines.flatMap((line, row) => {
    const words = line.split(" ");
    return words.map((word, col) => ({
      inferText: word,
      lineBreak: col === words.length - 1,
      boundingPoly: {
        vertices: [
          { x: 10 + col * 100, y: row * 40 },
          { x: 100 + col * 100, y: row * 40 },
          { x: 100 + col * 100, y: row * 40 + 30 },
          { x: 10 + col * 100, y: row * 40 + 30 },
        ],
      },
    }));
  });
}

test("실제 샘플: 영양성분 원본값이 정답과 같다", () => {
  assert.deepStrictEqual(result.nutritionRaw, {
    calories: 184,
    sodium: 20,
    carbohydrate: 39,
    sugar: 33,
    fat: 1.3,
    transFat: 0,
    saturatedFat: 0,
    cholesterol: 0,
    protein: 4,
  });
});

test("실제 샘플: 기준량", () => {
  assert.deepStrictEqual(result.basis, { amount: 55, unit: "g", text: "1봉지(55 g)당" });
});

test("실제 샘플: 100g당 환산", () => {
  assert.deepStrictEqual(result.nutritionPer100g, {
    calories: 334.55,
    sodium: 36.36,
    carbohydrate: 70.91,
    sugar: 60,
    fat: 2.36,
    transFat: 0,
    saturatedFat: 0,
    cholesterol: 0,
    protein: 7.27,
  });
});

test("실제 샘플: 제품명과 식품유형 (글자 순서가 뒤섞여 있어도)", () => {
  assert.strictEqual(result.productName, "포도과즙 그대로 마이구미");
  assert.strictEqual(result.foodType, "캔디류");
});

test("실제 샘플: 원재료는 줄바꿈으로 잘린 단어를 붙이고 함유 문구는 뺀다", () => {
  assert.deepStrictEqual(result.ingredients, [
    "물엿",
    "백설탕",
    "포도농축과즙",
    "젤라틴",
    "레몬농축과즙",
    "펙틴",
    "콜라겐",
    "산도조절제 2종",
    "블랙캐롯농축액",
    "합성향료(포도향)",
    "유크림",
    "기타식용유지가공품",
  ]);
});

test("실제 샘플: 함유와 혼입 가능을 나누고 warnings 는 비어 있다", () => {
  assert.deepStrictEqual(result.allergenText, ["우유", "돼지고기"]);
  assert.deepStrictEqual(result.mayContain, ["복숭아"]);
  assert.deepStrictEqual(result.warnings, []);
  assert.ok(result.rawText.includes("마이구미"));
});

test("지방은 트랜스지방, 포화지방을 잡지 않는다 (띄어쓴 경우 포함)", () => {
  const r = parseLabel(fieldsFrom(["100 g당", "트랜스 지방 1 g", "포화 지방 2 g"]));
  assert.strictEqual(r.nutritionRaw.transFat, 1);
  assert.strictEqual(r.nutritionRaw.saturatedFat, 2);
  assert.strictEqual(r.nutritionRaw.fat, null);
});

test("% 숫자는 영양성분 값이 아니고, 못 찾은 값은 null 이다", () => {
  const r = parseLabel(fieldsFrom(["100 g당", "나트륨 12 %", "단백질 0 g"]));
  assert.strictEqual(r.nutritionRaw.sodium, null);
  assert.strictEqual(r.nutritionPer100g.sodium, null);
  assert.strictEqual(r.nutritionRaw.protein, 0); // 실제 0 은 null 이 아니다
  assert.ok(r.warnings.includes("나트륨 값을 찾지 못했습니다."));
});

test("안내문의 2,000 kcal 은 열량이 아니다", () => {
  const r = parseLabel(fieldsFrom(["100 g당", "비율(%)은 2,000 kcal 기준"]));
  assert.strictEqual(r.nutritionRaw.calories, null);
});

test("ml 기준량은 1ml = 1g 으로 환산한다", () => {
  const r = parseLabel(fieldsFrom(["200 ml당", "당류 10 g"]));
  assert.deepStrictEqual(r.basis, { amount: 200, unit: "ml", text: "200 ml당" });
  assert.strictEqual(r.nutritionPer100g.sugar, 5);
});

test("총 내용량 기준량 문구도 찾는다", () => {
  const r = parseLabel(fieldsFrom(["총 내용량 165 g당", "당류 33 g"]));
  assert.strictEqual(r.basis.amount, 165);
  assert.strictEqual(r.basis.text, "총 내용량 165 g당");
});

test("기준량을 못 찾으면 basis 와 100g당 값이 null 이고 warnings 에 적는다", () => {
  const r = parseLabel(fieldsFrom(["총 내용량 165 g", "당류 33 g"]));
  assert.strictEqual(r.basis, null);
  assert.strictEqual(r.nutritionRaw.sugar, 33);
  assert.strictEqual(r.nutritionPer100g.sugar, null);
  assert.ok(r.warnings.some((w) => w.includes("기준량")));
});

test("무함유는 알레르기가 아니다", () => {
  const r = parseLabel(fieldsFrom(["설탕 무함유", "대두, 밀 함유"]));
  assert.deepStrictEqual(r.allergenText, ["대두", "밀"]);
});

test("함유 문구: 윗줄이 쉼표로 끝나면 잇고 원재료에서는 뺀다", () => {
  const r = parseLabel(
    fragmentsFrom(["원재료명 물엿, 설탕", "우유, 밀,", "대두 함유", "포장재질 폴리프로필렌"]),
  );
  assert.deepStrictEqual(r.allergenText, ["우유", "밀", "대두"]);
  assert.deepStrictEqual(r.ingredients, ["물엿", "설탕"]);
});

test("함유 문구: 쉼표가 세 줄에 걸쳐도 잇는다", () => {
  const r = parseLabel(fragmentsFrom(["우유,", "밀,", "대두 함유"]));
  assert.deepStrictEqual(r.allergenText, ["우유", "밀", "대두"]);
});

test("함유 문구: 윗줄이 쉼표로 끝나지 않으면 잇지 않는다", () => {
  const r = parseLabel(fragmentsFrom(["기타식용유", "우유, 돼지고기 함유"]));
  assert.deepStrictEqual(r.allergenText, ["우유", "돼지고기"]);
});

test("함유 문구: 글자 조각 순서가 뒤섞여도 좌표로 잇는다", () => {
  const fragments = fragmentsFrom(["우유, 밀,", "대두 함유"]);
  const shuffled = [...fragments.slice(2), ...fragments.slice(0, 2)]; // 아랫줄이 먼저 온다
  assert.deepStrictEqual(parseLabel(shuffled).allergenText, ["우유", "밀", "대두"]);
});

test("함유 문구: '함' + '유' 로 잘려도 잇고, '포함' 은 함유가 아니다", () => {
  assert.deepStrictEqual(parseLabel(fragmentsFrom(["우유, 밀 함", "유"])).allergenText, ["우유", "밀"]);
  assert.deepStrictEqual(parseLabel(fragmentsFrom(["향료 포함", "유크림"])).allergenText, []);
});

test("혼입 가능: '혼입' + '가능' 으로 잘려도 찾는다", () => {
  assert.deepStrictEqual(parseLabel(fragmentsFrom(["복숭아, 토마토 혼입", "가능"])).mayContain, [
    "복숭아",
    "토마토",
  ]);
});

test("같은 제조시설 문구도 mayContain 에 넣는다", () => {
  const r = parseLabel(
    fragmentsFrom(["이 제품은 메밀, 땅콩을 사용한 제품과 같은 제조시설에서 제조하고 있습니다"]),
  );
  assert.deepStrictEqual(r.mayContain, ["메밀", "땅콩"]);
  assert.deepStrictEqual(r.allergenText, []); // 함유와 구분된다
});

test("같은 제조시설 문구가 여러 줄로 잘려도 찾는다", () => {
  const r = parseLabel(
    fragmentsFrom(["이 제품은 메밀, 땅콩을", "사용한 제품과 같은 제조시", "설에서 제조하고 있습니다"]),
  );
  assert.deepStrictEqual(r.mayContain, ["메밀", "땅콩"]);
});

test("혼입 가능과 같은 제조시설 문구는 합치고 중복을 없앤다", () => {
  const r = parseLabel(
    fragmentsFrom([
      "복숭아 혼입 가능",
      "이 제품은 메밀, 복숭아를 사용한 제품과 같은 제조시설에서 제조하고 있습니다",
    ]),
  );
  assert.deepStrictEqual(r.mayContain, ["복숭아", "메밀"]);
  assert.ok(!r.warnings.some((w) => w.includes("복숭아") || w.includes("메밀")));
});

test("환산은 to_per_100 과 같은 사사오입이다", () => {
  assert.strictEqual(toPer100(1.005, 100), 1.01); // 단순 소수 계산이면 1 이 나오는 값
  assert.strictEqual(toPer100(null, 100), null);
});

test("알레르기 이름 확인: 잘린 이름은 그대로 두고 경고한다", () => {
  const r = parseLabel(fragmentsFrom(["우유, 돼지고", "기 함유"]));
  assert.deepStrictEqual(r.allergenText, ["기"]);
  assert.ok(r.warnings.includes("알레르기 문구 일부를 정확히 읽지 못함: 기"));
});

test("알레르기 이름 확인: 목록에 없는 이름은 함유와 혼입 모두 경고한다", () => {
  const r = parseLabel(fragmentsFrom(["칼슘 함유", "키위 혼입 가능"]));
  assert.deepStrictEqual(r.allergenText, ["칼슘"]);
  assert.deepStrictEqual(r.mayContain, ["키위"]);
  assert.ok(r.warnings.includes("알레르기 문구 일부를 정확히 읽지 못함: 칼슘, 키위"));
});

test("알레르기 이름 확인: 목록에 있는 표기는 경고하지 않는다", () => {
  const r = parseLabel(
    fragmentsFrom(["달걀, 소고기, 알류(달걀), 조개류(굴) 함유", "복숭아 혼입 가능"]),
  );
  assert.deepStrictEqual(r.allergenText, ["달걀", "소고기", "알류(달걀)", "조개류(굴)"]);
  assert.deepStrictEqual(r.mayContain, ["복숭아"]);
  assert.ok(!r.warnings.some((w) => w.includes("정확히 읽지 못함")));
});

test("함유 문구의 이름은 바로 다음 혼입 문구에 섞이지 않는다", () => {
  const twoLines = parseLabel(fragmentsFrom(["대두, 우유 함유", "복숭아 혼입 가능"]));
  assert.deepStrictEqual(twoLines.allergenText, ["대두", "우유"]);
  assert.deepStrictEqual(twoLines.mayContain, ["복숭아"]);

  const oneLine = parseLabel(fragmentsFrom(["대두, 우유 함유 복숭아 혼입 가능"]));
  assert.deepStrictEqual(oneLine.mayContain, ["복숭아"]);
});

test("괄호가 있는 이름: 쉼표로 나누지 않고 함유, 제조시설 문구 모두 잡는다", () => {
  const contains = parseLabel(fragmentsFrom(["우유, 조개류(굴, 홍합) 함유"]));
  assert.deepStrictEqual(contains.allergenText, ["우유", "조개류(굴, 홍합)"]);

  const facility = parseLabel(
    fragmentsFrom(["이 제품은 메밀, 조개류(굴, 전복)를 사용한 제품과 같은 제조시설에서 제조"]),
  );
  assert.deepStrictEqual(facility.mayContain, ["메밀", "조개류(굴,전복)"]);
});

test("괄호 안 함유 문구: 이름은 잡고 원재료는 유지한다", () => {
  const r = parseLabel(fragmentsFrom(["원재료명 물엿, 유크림(우유 함유)", "포장재질 폴리에틸렌"]));
  assert.deepStrictEqual(r.allergenText, ["우유"]);
  assert.deepStrictEqual(r.ingredients, ["물엿", "유크림(우유 함유)"]);
});

test("글자가 없어도 죽지 않는다", () => {
  const r = parseLabel([]);
  assert.strictEqual(r.productName, null);
  assert.strictEqual(r.basis, null);
  assert.deepStrictEqual(r.ingredients, []);
  assert.strictEqual(r.rawText, "");
});
