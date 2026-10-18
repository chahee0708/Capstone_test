/**
 * labelService.js
 *
 * 사용자가 촬영/입력한 영양성분표(OCR 결과 등)를 판정 로직이 쓰는 형식으로 변환한다.
 *
 *   - 입력 필드명은 데이터 CSV 컬럼과 동일(energy_kcal, sodium_mg …)
 *   - 영양성분 표시 기준량(예: 1회 제공량 30g, 총 내용량 70ml)이 100g/100ml 이 아니면
 *     판정 기준(식품 100g당)에 맞게 환산한다.
 */

// 입력 필드 → 판정 서비스 필드
const FIELD_MAP = {
  energy_kcal: "calories",
  sodium_mg: "sodium",
  carbohydrate_g: "carbohydrate",
  sugar_g: "sugar",
  fat_g: "fat",
  trans_fat_g: "transFat",
  saturated_fat_g: "saturatedFat",
  cholesterol_mg: "cholesterol",
  protein_g: "protein",
  dietary_fiber_g: "fiber",
  potassium_mg: "potassium",
  phosphorus_mg: "phosphorus",
};

// 값 상한 (표시 기준량 기준, 비현실적인 입력/OCR 오인식 차단)
const LIMITS = {
  energy_kcal: 10000,
  sodium_mg: 100000,
  carbohydrate_g: 2000,
  sugar_g: 2000,
  fat_g: 2000,
  trans_fat_g: 500,
  saturated_fat_g: 1000,
  cholesterol_mg: 20000,
  protein_g: 2000,
  dietary_fiber_g: 1000,
  potassium_mg: 100000,
  phosphorus_mg: 100000,
};

const LABELS = {
  energy_kcal: "열량",
  sodium_mg: "나트륨",
  carbohydrate_g: "탄수화물",
  sugar_g: "당류",
  fat_g: "지방",
  trans_fat_g: "트랜스지방",
  saturated_fat_g: "포화지방",
  cholesterol_mg: "콜레스테롤",
  protein_g: "단백질",
  dietary_fiber_g: "식이섬유",
  potassium_mg: "칼륨",
  phosphorus_mg: "인",
};

// 판정에 직접 쓰이는 핵심 항목 — 비어 있으면 사용자에게 알린다
const CORE_FIELDS = [
  "energy_kcal", "sodium_mg", "carbohydrate_g", "sugar_g", "fat_g",
  "saturated_fat_g", "trans_fat_g", "protein_g",
];

function asNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function stringList(v, max = 30, itemMax = 40) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const t = item.trim().slice(0, itemMax);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 요청 body 검증/정규화
 * @returns {{ value: object|null, errors: string[] }}
 */
function validateLabelInput(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { value: null, errors: ["요청 형식이 올바르지 않습니다."] };
  }

  const rawNutrition = body.nutrition;
  if (!rawNutrition || typeof rawNutrition !== "object") {
    return { value: null, errors: ["영양성분(nutrition)이 필요합니다."] };
  }

  const nutrition = {};
  let provided = 0;
  for (const key of Object.keys(FIELD_MAP)) {
    const n = asNumberOrNull(rawNutrition[key]);
    if (Number.isNaN(n)) {
      errors.push(`${LABELS[key]} 값은 숫자여야 합니다.`);
      continue;
    }
    if (n !== null) {
      if (n < 0 || n > LIMITS[key]) {
        errors.push(`${LABELS[key]} 값이 올바른 범위(0~${LIMITS[key]})를 벗어났습니다.`);
        continue;
      }
      provided += 1;
    }
    nutrition[key] = n;
  }
  if (errors.length > 0) return { value: null, errors };
  if (provided === 0) return { value: null, errors: ["영양성분 값을 하나 이상 입력해주세요."] };

  let referenceAmount = asNumberOrNull(body.referenceAmount);
  if (Number.isNaN(referenceAmount) || (referenceAmount !== null && (referenceAmount < 1 || referenceAmount > 5000))) {
    return { value: null, errors: ["영양성분 기준량은 1~5000 사이의 숫자(g 또는 ml)여야 합니다."] };
  }
  if (referenceAmount === null) referenceAmount = 100;

  const productName = typeof body.productName === "string" ? body.productName.trim().slice(0, 100) : "";
  const ingredients = typeof body.ingredients === "string" ? body.ingredients.slice(0, 6000) : "";

  return {
    value: {
      nutrition,
      referenceAmount,
      productName,
      ingredients,
      declaredAllergens: stringList(body.declaredAllergens),
      crossAllergens: stringList(body.crossAllergens),
    },
    errors: [],
  };
}

/**
 * 표시 기준량 → 100g(ml)당으로 환산하고 판정 서비스 형식으로 변환한다.
 * 비어 있는 값은 0으로 두되, 핵심 항목 중 비어 있는 것을 missing 으로 알려 준다.
 */
function toPer100(nutritionInput, referenceAmount = 100) {
  const factor = referenceAmount > 0 ? 100 / referenceAmount : 1;
  const nutrition = {};
  for (const [src, dst] of Object.entries(FIELD_MAP)) {
    const v = nutritionInput[src];
    nutrition[dst] = v === null || v === undefined ? 0 : Math.round(v * factor * 100) / 100;
  }
  const missing = CORE_FIELDS.filter((k) => nutritionInput[k] === null || nutritionInput[k] === undefined).map(
    (k) => LABELS[k]
  );
  return { nutrition, factor, missing };
}

module.exports = { FIELD_MAP, LABELS, validateLabelInput, toPer100 };
