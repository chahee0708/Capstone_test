const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateProfile,
  toColumnValues,
  toPublicProfile,
} = require("../services/profileService");

test("정상 프로필을 정규화한다 (빈 문자열 → null, 성별/단계 별칭 변환)", () => {
  const { value, errors } = validateProfile({
    name: " 홍길동 ",
    age: "36",
    weight: 72.5,
    height: "",
    gender: "남성",
    diseases: [" 고혈압 ", "고혈압", ""],
    allergens: ["우유"],
    hypertension_stage: "Stage II",
    ldl_value: "",
    gfr_value: null,
  });
  assert.deepEqual(errors, []);
  assert.equal(value.name, "홍길동");
  assert.equal(value.age, 36);
  assert.equal(value.weight, 72.5);
  assert.equal(value.height, null);
  assert.equal(value.gender, "male");
  assert.deepEqual(value.diseases, ["고혈압"]);
  assert.equal(value.hypertension_stage, 2);
  assert.equal(value.ldl_value, null);
  assert.equal(value.gfr_value, 35); // 미입력 GFR 은 기존 기본값(35)
});

test("GFR 0(이식 환자)은 그대로 유지된다", () => {
  const { value } = validateProfile({ gfr_value: 0 });
  assert.equal(value.gfr_value, 0);
});

test("요청에 없는 필드는 결과에도 없다 (부분 업데이트)", () => {
  const { value, errors } = validateProfile({ weight: 70 });
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(value), ["weight"]);
});

test("범위/형식 오류를 거부한다", () => {
  for (const bad of [
    { age: 0 },
    { age: 200 },
    { age: 36.5 },
    { weight: -5 },
    { height: "abc" },
    { gender: "other" },
    { diseases: "고혈압" },
    { diseases: [1] },
    { hypertension_stage: 3 },
    { ldl_value: 99999 },
    { name: "" },
  ]) {
    const { errors } = validateProfile(bad);
    assert.ok(errors.length > 0, `거부되어야 함: ${JSON.stringify(bad)}`);
  }
});

test("body 가 객체가 아니면 오류", () => {
  assert.ok(validateProfile(null).errors.length > 0);
  assert.ok(validateProfile([]).errors.length > 0);
  assert.ok(validateProfile("x").errors.length > 0);
});

test("toColumnValues 는 화이트리스트 컬럼만 사용하고 JSON 컬럼을 직렬화한다", () => {
  const { columns, values } = toColumnValues({
    name: "a",
    diseases: ["고혈압"],
    "id; DROP TABLE users": 1,
  });
  assert.deepEqual(columns, ["name", "diseases"]);
  assert.deepEqual(values, ["a", '["고혈압"]']);
});

test("toPublicProfile 은 비밀번호를 포함하지 않고 JSON 컬럼을 파싱한다", () => {
  const p = toPublicProfile({
    id: 1,
    name: "홍길동",
    email: "a@b.c",
    password: "hash",
    diseases: '["고혈압"]',
    allergens: "깨진JSON",
    age: null,
  });
  assert.equal("password" in p, false);
  assert.deepEqual(p.diseases, ["고혈압"]);
  assert.deepEqual(p.allergens, []);
  assert.equal(p.age, null);
  assert.equal(p.gfr_value, 35);
});
