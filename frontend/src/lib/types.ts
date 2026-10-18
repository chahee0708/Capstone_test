/**
 * 백엔드 응답 타입 (routes/recommend.js, routes/ocr.js 와 일치해야 함)
 */

export type Verdict = "추천" | "주의" | "비추천";

/** 알레르기 연결 강도 (services/allergenKnowledge.js 참고) */
export type AllergenLevel = "declared" | "ingredient" | "derived" | "possible" | "cross";
/** contains: 들어 있음 / may_contain: 가능성 */
export type AllergenSeverity = "contains" | "may_contain";

export type AllergenEvidence = {
  ingredient: string;
  keyword: string;
  level: AllergenLevel;
  parent?: string;
};

export type AllergenMatch = {
  allergen: string; // 사용자가 등록한 이름
  canonical: string; // 표준 항목 이름
  level: AllergenLevel;
  severity: AllergenSeverity;
  label: string;
  evidence: AllergenEvidence[];
};

export type NutrientEvaluation = {
  nutrient: string;
  value: number;
  dailyLimit: number;
  percent: number;
  level: "low" | "mid" | "high";
  disease?: string;
};

export type NutritionValues = {
  sugar: number;
  sodium: number;
  saturatedFat: number;
  protein: number;
  calories?: number;
  carbohydrate?: number;
  fat?: number;
  transFat?: number;
  cholesterol?: number;
  fiber?: number;
};

export type AnalysisResult = {
  productName: string;
  manufacturer: string | null;
  reportNo: string | null;
  source: "db" | "barcode" | "ocr";
  userType: "disease";
  diseaseTrack: "diabetes" | "rule";
  verdict: Verdict;
  giCategory: "Low" | "Medium" | "High" | null;
  bmi: string | null;
  nutrition: NutritionValues;
  warnings: string[];
  evaluations: NutrientEvaluation[];
  allergenAlert: string[];
  allergenMatches: AllergenMatch[];
  allergenCoverage: {
    checked: boolean;
    opaqueIngredients: string[];
    notice: string;
  };
  registeredAllergens: string[];
  unsupportedDiseases?: string[];
  evaluatedDiseases?: string[];
  dailyReference: {
    나트륨: number;
    당류: number;
    탄수화물: number;
    단백질: number;
    식이섬유: number;
    에너지?: number;
  };
  label?: {
    referenceAmount: number;
    normalizedTo: number;
    factor: number;
    missingNutrients: string[];
    hasIngredients: boolean;
  };
};

export type FoodSuggestion = {
  name: string;
  manufacturer: string | null;
  reportNo: string | null;
};

/** 분석 없이 안내 메시지만 오는 응답 (질환 없음/미지원) */
export type NoticeResponse = {
  userType: "healthy" | "unsupported";
  message: string;
};

export type BarcodeOutcome =
  | ({ status: "ok"; code: string } & AnalysisResult)
  | {
      status: "no_nutrition";
      code: string;
      reportNo: string;
      productName: string | null;
      manufacturer: string | null;
      message: string;
    }
  | { status: "not_found"; code: string; message: string }
  | { status: "decode_failed"; message: string };

export type NutrientKey =
  | "energy_kcal"
  | "sodium_mg"
  | "carbohydrate_g"
  | "sugar_g"
  | "fat_g"
  | "trans_fat_g"
  | "saturated_fat_g"
  | "cholesterol_mg"
  | "protein_g"
  | "dietary_fiber_g"
  | "potassium_mg"
  | "phosphorus_mg";

export type OcrWarning = { code: string; message: string; fields?: string[] };

export type OcrLabelResult = {
  status: "ok" | "partial" | "empty";
  product: { name: string | null; manufacturer: string | null; reportNo: string | null };
  reference: { amount: number | null; unit: string | null; text: string | null; basis: string };
  nutrition: Record<NutrientKey, number | null>;
  /** 라벨에 "1g 미만" 처럼 인쇄된 항목 (값은 표기된 기준값) */
  qualifiers?: Partial<Record<NutrientKey, "lt">>;
  ingredients: string;
  /** OCR 오독으로 보여 사전으로 자동 보정한 원재료 단어 */
  ingredientCorrections?: { from: string; to: string }[];
  allergens: {
    declared: string[];
    cross: string[];
    detected: { allergen: string; level: AllergenLevel; evidence: AllergenEvidence[] }[];
    opaqueIngredients: string[];
  };
  warnings: OcrWarning[];
  confidence: number;
  rawText: string;
};

export type OcrCheckupResult = {
  status: "ok" | "partial" | "empty";
  profile: {
    age: number | null;
    gender: "male" | "female" | null;
    height: number | null;
    weight: number | null;
    ldl_value: number | null;
    tg_value: number | null;
    hdl_value: number | null;
    gfr_value: number | null;
    hypertension_stage: 1 | 2 | null;
  };
  vitals: {
    systolic: number | null;
    diastolic: number | null;
    fastingGlucose: number | null;
    totalCholesterol: number | null;
  };
  diseases: string[];
  suggestedDiseases: { name: string; reason: string }[];
  allergens: string[];
  warnings: OcrWarning[];
  confidence: number;
};
