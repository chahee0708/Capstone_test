/**
 * ocr.js
 *
 *   POST /ocr/label    multipart images[1..4]   식품 라벨(영양성분표/원재료명) 사진 → 구조화 결과  (로그인 필요)
 *   POST /ocr/checkup  multipart image          건강검진 결과지 사진 → 프로필 항목              (가입 화면에서 사용, 로그인 불필요)
 *
 * 실제 인식은 ML 서비스(RapidOCR + 파서)가 수행하고, 여기서는
 *   - 업로드 검증 / 요청 제한
 *   - 알레르기 표시 문구 해석 및 원재료 기반 알레르기 미리보기
 *   - 클라이언트가 쓰기 쉬운 형태(camelCase)로 응답 정리
 * 를 담당한다.
 *
 * OCR 결과는 "초안"이다. 클라이언트는 사용자가 확인·수정한 뒤에만 분석/저장해야 한다.
 */

const express = require("express");
const { parseAllergenStatement, detectAllergens, findOpaqueIngredients } = require("../services/allergenMatcher");
const { MlServiceError, MlRequestError } = require("../services/errors");
const rateLimit = require("../middleware/rateLimit");

const NUTRIENT_KEYS = [
  "energy_kcal", "sodium_mg", "carbohydrate_g", "sugar_g", "fat_g", "trans_fat_g",
  "saturated_fat_g", "cholesterol_mg", "protein_g", "dietary_fiber_g", "potassium_mg", "phosphorus_mg",
];

function numberOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** ML 라벨 결과 → 클라이언트 응답 */
function shapeLabelResult(ml) {
  const nutrition = {};
  for (const k of NUTRIENT_KEYS) nutrition[k] = numberOrNull(ml.nutrition?.[k]);

  // 라벨에 "1g 미만" 으로 인쇄된 항목 — 값은 표기된 기준값이며, 화면에서 "미만" 표기였음을 알려 준다
  const qualifiers = {};
  for (const k of NUTRIENT_KEYS) {
    if (ml.qualifiers?.[k] === "lt" && nutrition[k] !== null) qualifiers[k] = "lt";
  }

  const ingredients = typeof ml.ingredients === "string" ? ml.ingredients : "";
  const allergyText = typeof ml.allergy_text === "string" ? ml.allergy_text : "";

  // 알레르기 표시 문구("우유, 대두 함유", "같은 제조시설 …")와 원재료 기반 검출
  const stmt = parseAllergenStatement(`${ingredients}\n${allergyText}`);
  const detected = Object.entries(detectAllergens(ingredients)).map(([name, d]) => ({
    allergen: name,
    level: d.level,
    evidence: d.evidence.slice(0, 3),
  }));

  return {
    status: ml.status || "partial",
    product: {
      name: ml.product?.name ?? null,
      manufacturer: ml.product?.manufacturer ?? null,
      reportNo: ml.product?.report_no ?? null,
    },
    reference: {
      amount: numberOrNull(ml.reference?.amount),
      unit: ml.reference?.unit ?? null,
      text: ml.reference?.text ?? null,
      basis: ml.reference?.basis ?? "unknown",
    },
    nutrition,
    qualifiers,
    ingredients,
    // OCR 이 틀리게 읽어 사전으로 자동 보정한 원재료 단어 ({from, to})
    ingredientCorrections: (Array.isArray(ml.ingredient_corrections) ? ml.ingredient_corrections : [])
      .filter((c) => c && typeof c.from === "string" && typeof c.to === "string")
      .slice(0, 30)
      .map((c) => ({ from: c.from.slice(0, 40), to: c.to.slice(0, 40) })),
    allergens: {
      declared: stmt.declared,
      cross: stmt.cross,
      detected,
      opaqueIngredients: findOpaqueIngredients(ingredients),
    },
    warnings: Array.isArray(ml.warnings) ? ml.warnings : [],
    confidence: numberOrNull(ml.confidence) ?? 0,
    rawText: typeof ml.raw_text === "string" ? ml.raw_text : "",
  };
}

/** ML 건강검진 결과 → 가입 폼에 채울 프로필 */
function shapeCheckupResult(ml) {
  const p = ml.profile || {};
  const gender = p.gender === "male" || p.gender === "female" ? p.gender : null;
  return {
    status: ml.status || "partial",
    profile: {
      age: numberOrNull(p.age),
      gender,
      height: numberOrNull(p.height_cm),
      weight: numberOrNull(p.weight_kg),
      ldl_value: numberOrNull(p.ldl_value),
      tg_value: numberOrNull(p.tg_value),
      hdl_value: numberOrNull(p.hdl_value),
      gfr_value: numberOrNull(p.gfr_value),
      hypertension_stage: p.hypertension_stage === 1 || p.hypertension_stage === 2 ? p.hypertension_stage : null,
    },
    vitals: {
      systolic: numberOrNull(p.systolic),
      diastolic: numberOrNull(p.diastolic),
      fastingGlucose: numberOrNull(p.fasting_glucose),
      totalCholesterol: numberOrNull(p.total_cholesterol),
    },
    diseases: Array.isArray(ml.diseases) ? ml.diseases : [],
    suggestedDiseases: Array.isArray(ml.suggested_diseases) ? ml.suggested_diseases : [],
    allergens: Array.isArray(ml.allergens) ? ml.allergens : [],
    warnings: Array.isArray(ml.warnings) ? ml.warnings : [],
    confidence: numberOrNull(ml.confidence) ?? 0,
  };
}

/**
 * @param {object} deps
 * @param {object} deps.mlClient
 * @param {object} deps.upload              multer 인스턴스
 * @param {Function} deps.authMiddleware
 * @param {boolean} [deps.enableRateLimit]
 */
function createOcrRouter({ mlClient, upload, authMiddleware, enableRateLimit = true }) {
  const router = express.Router();

  const passthrough = (req, res, next) => next();
  const labelLimiter = enableRateLimit
    ? rateLimit({
        windowMs: 60 * 1000,
        max: 12,
        message: "이미지 분석 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        keyFn: (req) => `label|${req.user?.id ?? req.ip}`,
      })
    : passthrough;
  // 가입 전(비로그인) 사용 — IP 기준으로 더 엄격하게 제한
  const checkupLimiter = enableRateLimit
    ? rateLimit({
        windowMs: 10 * 60 * 1000,
        max: 10,
        message: "이미지 분석 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        keyFn: (req) => `checkup|${req.ip}`,
      })
    : passthrough;

  function fail(res, err, label) {
    if (err instanceof MlServiceError) {
      console.error(`${label} ML 오류:`, err.message, err.cause || "");
      return res.status(503).json({ message: "이미지 분석 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." });
    }
    if (err instanceof MlRequestError) {
      return res.status(err.status || 400).json({ message: err.message });
    }
    console.error(`${label} 오류:`, err);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }

  router.post("/label", authMiddleware, labelLimiter, upload.array("images", 4), async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ message: "분석할 이미지를 첨부해주세요." });
    }
    try {
      const ml = await mlClient.ocrLabel(files);
      res.json(shapeLabelResult(ml));
    } catch (err) {
      fail(res, err, "라벨 OCR");
    }
  });

  router.post("/checkup", checkupLimiter, upload.single("image"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "분석할 이미지를 첨부해주세요." });
    }
    try {
      const ml = await mlClient.ocrCheckup(req.file);
      res.json(shapeCheckupResult(ml));
    } catch (err) {
      fail(res, err, "검진 OCR");
    }
  });

  return router;
}

module.exports = createOcrRouter;
module.exports.shapeLabelResult = shapeLabelResult;
module.exports.shapeCheckupResult = shapeCheckupResult;
