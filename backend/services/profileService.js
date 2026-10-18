/**
 * profileService.js
 *
 * 역할: 사용자 건강 프로필 입력값 검증/정규화 + DB 컬럼 매핑
 *
 * - 회원가입(auth.js)과 프로필 수정(user.js)이 같은 규칙을 쓰도록 한 곳에 둔다.
 * - 요청 body에 "존재하는" 필드만 검증해서 반환한다(부분 업데이트 지원).
 */

const MAX_LIST_ITEMS = 20;
const MAX_ITEM_LENGTH = 30;

const GENDER_ALIASES = {
  male: "male",
  female: "female",
  남성: "male",
  여성: "female",
  남: "male",
  여: "female",
};

const HYPERTENSION_ALIASES = {
  1: 1,
  2: 2,
  "Stage I": 1,
  "Stage II": 2,
};

function has(body, key) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function isBlank(v) {
  return v === null || v === undefined || v === "";
}

/**
 * 숫자 범위 검증. 빈 값은 null 로 정규화한다.
 * 범위를 벗어나거나 숫자가 아니면 errors 에 메시지를 추가한다.
 */
function numberField(body, key, label, { min, max, integer = false }, out, errors) {
  if (!has(body, key)) return;
  const raw = body[key];
  if (isBlank(raw)) {
    out[key] = null;
    return;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
    errors.push(`${label} 값은 ${integer ? "정수" : "숫자"}여야 합니다.`);
    return;
  }
  if (n < min || n > max) {
    errors.push(`${label} 값은 ${min}~${max} 사이여야 합니다.`);
    return;
  }
  out[key] = n;
}

function stringListField(body, key, label, out, errors) {
  if (!has(body, key)) return;
  const raw = body[key];
  if (raw === null || raw === undefined) {
    out[key] = [];
    return;
  }
  if (!Array.isArray(raw)) {
    errors.push(`${label} 항목 형식이 올바르지 않습니다.`);
    return;
  }
  const cleaned = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      errors.push(`${label} 항목은 문자열이어야 합니다.`);
      return;
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_ITEM_LENGTH) {
      errors.push(`${label} 항목은 ${MAX_ITEM_LENGTH}자 이하여야 합니다.`);
      return;
    }
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
  }
  if (cleaned.length > MAX_LIST_ITEMS) {
    errors.push(`${label}은 최대 ${MAX_LIST_ITEMS}개까지 입력할 수 있습니다.`);
    return;
  }
  out[key] = cleaned;
}

/**
 * @param {object} body - 요청 body (또는 body.profile)
 * @returns {{ value: object, errors: string[] }}
 *   value: 요청에 포함된 필드만 정규화된 값으로 담긴 객체 (DB 컬럼명과 동일)
 */
function validateProfile(body) {
  const out = {};
  const errors = [];

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { value: out, errors: ["요청 형식이 올바르지 않습니다."] };
  }

  if (has(body, "name")) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 50) {
      errors.push("이름은 1~50자여야 합니다.");
    } else {
      out.name = name;
    }
  }

  numberField(body, "age", "나이", { min: 1, max: 120, integer: true }, out, errors);
  numberField(body, "weight", "몸무게", { min: 10, max: 500 }, out, errors);
  numberField(body, "height", "키", { min: 50, max: 250 }, out, errors);

  if (has(body, "gender")) {
    if (isBlank(body.gender)) {
      out.gender = null;
    } else if (GENDER_ALIASES[body.gender]) {
      out.gender = GENDER_ALIASES[body.gender];
    } else {
      errors.push("성별은 male 또는 female 이어야 합니다.");
    }
  }

  stringListField(body, "diseases", "질환", out, errors);
  stringListField(body, "allergens", "알레르기", out, errors);

  if (has(body, "hypertension_stage")) {
    if (isBlank(body.hypertension_stage)) {
      out.hypertension_stage = 1;
    } else if (HYPERTENSION_ALIASES[body.hypertension_stage] !== undefined) {
      out.hypertension_stage = HYPERTENSION_ALIASES[body.hypertension_stage];
    } else {
      errors.push("고혈압 단계는 1 또는 2 여야 합니다.");
    }
  }

  numberField(body, "ldl_value", "LDL 수치", { min: 0, max: 1500 }, out, errors);
  numberField(body, "tg_value", "중성지방 수치", { min: 0, max: 5000 }, out, errors);
  numberField(body, "hdl_value", "HDL 수치", { min: 0, max: 500 }, out, errors);
  numberField(body, "gfr_value", "GFR 수치", { min: 0, max: 200 }, out, errors);

  // 기존 동작 유지: GFR 미입력은 중기(35)로 간주한다. (0 은 이식 환자이므로 별개)
  if (has(out, "gfr_value") && out.gfr_value === null) out.gfr_value = 35;

  return { value: out, errors };
}

// DB에 JSON 으로 저장되는 컬럼
const JSON_COLUMNS = new Set(["diseases", "allergens"]);

// UPDATE/INSERT 에 사용할 수 있는 컬럼 화이트리스트 (SQL 조각을 만들 때 이 목록만 사용)
const PROFILE_COLUMNS = [
  "name",
  "age",
  "weight",
  "height",
  "gender",
  "diseases",
  "allergens",
  "hypertension_stage",
  "ldl_value",
  "tg_value",
  "hdl_value",
  "gfr_value",
];

/**
 * validateProfile 결과를 DB 바인딩용 { columns, values } 로 변환
 */
function toColumnValues(value) {
  const columns = [];
  const values = [];
  for (const col of PROFILE_COLUMNS) {
    if (!has(value, col)) continue;
    columns.push(col);
    values.push(JSON_COLUMNS.has(col) ? JSON.stringify(value[col]) : value[col]);
  }
  return { columns, values };
}

/**
 * JSON 컬럼(문자열 또는 이미 배열)을 안전하게 문자열 배열로 변환
 */
function parseJsonList(raw) {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((v) => String(v).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/**
 * users 테이블 row → 클라이언트에 내려줄 프로필 객체
 * (password, email 등 민감 정보는 포함하지 않는다)
 */
function toPublicProfile(row) {
  return {
    id: row.id,
    name: row.name,
    age: row.age ?? null,
    weight: row.weight ?? null,
    height: row.height ?? null,
    gender: row.gender ?? null,
    diseases: parseJsonList(row.diseases),
    allergens: parseJsonList(row.allergens),
    hypertension_stage: row.hypertension_stage ?? 1,
    ldl_value: row.ldl_value ?? null,
    tg_value: row.tg_value ?? null,
    hdl_value: row.hdl_value ?? null,
    gfr_value: row.gfr_value ?? 35,
  };
}

module.exports = {
  validateProfile,
  toColumnValues,
  toPublicProfile,
  parseJsonList,
  PROFILE_COLUMNS,
};
