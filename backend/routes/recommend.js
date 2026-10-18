/**
 * recommend.js
 *
 * 식품 분석 엔드포인트 모음. 모두 로그인 필요(사용자는 세션으로만 식별한다).
 *
 *   GET  /recommend/search?q=            식품명 자동완성
 *   POST /recommend                      { foodName | reportNo }       DB 식품 분석
 *   POST /recommend/barcode              { code }                      바코드 번호 → 분석
 *   POST /recommend/barcode/image        multipart image               바코드 사진 → 분석
 *   POST /recommend/label                { nutrition, ingredients, … } OCR/직접 입력 라벨 분석
 *
 * 공통 처리 흐름:
 *   1. MySQL 에서 사용자(질환/알레르기/신체정보) 조회
 *   2. 질환 없음 → 안내, 신체정보 누락 → 422
 *   3. scoreService 로 질환별 판정 (2형 당뇨는 ML, 나머지는 규칙)
 *   4. allergyService 로 알레르기 성분 매핑 (원재료명/라벨 표시 문구)
 *   5. 응답 조립 (dailyReference, 영양소별 평가 포함)
 */

const express = require("express");

const { getDailyReference } = require("../services/scoreService");
const { getFoodRecord, searchFoods } = require("../services/foodService");
const { analyzeFoodAllergens, analyzeIngredientText } = require("../services/allergyService");
const { parseJsonList } = require("../services/profileService");
const { validateLabelInput, toPer100 } = require("../services/labelService");
const {
  normalizeBarcode,
  isPlausibleBarcode,
  hasValidCheckDigit,
} = require("../services/barcodeUtil");
const { MlRequestError } = require("../services/errors");
const rateLimit = require("../middleware/rateLimit");

const MAX_FOOD_NAME_LENGTH = 200;

const ALLERGEN_NOTICE =
  "원재료명 기준 추정입니다. 교차오염이나 표기에 없는 성분은 확인할 수 없으니 제품 포장의 알레르기 표시를 꼭 확인하세요.";

/**
 * @param {object} deps
 * @param {{ execute: Function }} deps.db            MySQL (pool)
 * @param {() => object} deps.getSession             Neo4j 세션 생성 함수
 * @param {Function} deps.scoreForDiseaseUser        판정 함수 (테스트 시 주입)
 * @param {Function} deps.MlServiceError             ML 오류 클래스
 * @param {object}   deps.mlClient                   바코드/OCR 호출 클라이언트
 * @param {object}   deps.upload                     multer 인스턴스
 * @param {boolean}  [deps.enableRateLimit]          이미지 처리 요청 제한 (기본 true)
 */
function createRecommendRouter({
  db,
  getSession,
  scoreForDiseaseUser,
  MlServiceError,
  mlClient,
  upload,
  enableRateLimit = true,
}) {
  const router = express.Router();

  // 이미지 디코딩은 CPU 를 쓰므로 사용자별로 분당 횟수를 제한한다
  const imageLimiter = enableRateLimit
    ? rateLimit({
        windowMs: 60 * 1000,
        max: 20,
        message: "이미지 분석 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        keyFn: (req) => `barcode-img|${req.user?.id ?? req.ip}`,
      })
    : (req, res, next) => next();

  // ── 공통: 사용자 컨텍스트 ─────────────────────────────────────
  /**
   * 사용자를 조회하고 판정 가능한 상태인지 확인한다.
   * 판정할 수 없으면 응답을 직접 보내고 null 을 반환한다.
   */
  async function prepareUser(req, res) {
    const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (rows.length === 0) {
      res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
      return null;
    }

    const user = rows[0];
    const diseases = parseJsonList(user.diseases);
    const allergens = parseJsonList(user.allergens);

    // 건강한 사용자 → 현재 차단
    if (diseases.length === 0) {
      res.status(200).json({
        userType: "healthy",
        message: "현재 질환 보유자 대상 서비스입니다. 건강 관리 기능은 준비 중입니다.",
      });
      return null;
    }

    // 나이/성별이 없으면 KDRI 기준값이 틀어지고, 몸무게가 없으면 신장병 단백질 한도를 계산할 수 없다.
    const missing = [];
    if (!user.age) missing.push("나이");
    if (!user.gender) missing.push("성별");
    if (!user.weight) missing.push("몸무게");
    if (!user.height) missing.push("키");
    if (missing.length > 0) {
      res.status(422).json({
        code: "PROFILE_INCOMPLETE",
        message: `정확한 판정을 위해 프로필에서 ${missing.join(", ")} 항목을 먼저 입력해주세요.`,
        missing,
      });
      return null;
    }

    return {
      user,
      diseases,
      allergens,
      diseaseDetails: {
        hypertension_stage: user.hypertension_stage || 1,
        ldl_value: user.ldl_value ?? null,
        tg_value: user.tg_value ?? null,
        hdl_value: user.hdl_value ?? null,
        gfr_value: user.gfr_value ?? 35,
      },
    };
  }

  /**
   * 영양성분 + 알레르기 결과를 판정하고 응답 본문을 만든다.
   * @returns {Promise<object|null>} 미지원 질환만 있는 경우 안내 응답 객체(userType=unsupported)
   */
  async function judge(ctx, session, { productName, meta, nutrition, allergy, source, extra = {} }) {
    const { user, diseases, diseaseDetails } = ctx;

    const result = await scoreForDiseaseUser(
      session,
      productName,
      diseases,
      user.weight,
      user.height,
      user.age,
      user.gender,
      diseaseDetails,
      { getNutrition: async () => nutrition },
    );

    if (!result) return { status: 404, body: { message: "음식을 찾을 수 없습니다." } };

    if (result.unsupported) {
      return {
        status: 200,
        body: {
          userType: "unsupported",
          message: `등록하신 질환(${result.unsupportedDiseases.join(", ")})은 아직 판정을 지원하지 않습니다.`,
          unsupportedDiseases: result.unsupportedDiseases,
        },
      };
    }

    return {
      status: 200,
      body: {
        productName,
        manufacturer: meta?.manufacturer ?? null,
        reportNo: meta?.reportNo ?? null,
        source, // "db" | "barcode" | "ocr"
        userType: "disease",
        diseaseTrack: result.diseaseTrack, // "diabetes" | "rule"
        verdict: result.verdict, // "추천" | "주의" | "비추천"
        giCategory: result.giCategory, // 2형 당뇨 보유 시: "Low"|"Medium"|"High", 그 외: null
        bmi: result.bmi,
        nutrition: result.nutrition,
        warnings: result.warnings,
        evaluations: result.evaluations || [],
        allergenAlert: allergy.names, // 하위 호환: 검출된 사용자 알레르기 이름
        allergenMatches: allergy.matches, // 근거(원재료, 키워드, 강도) 포함
        allergenCoverage: {
          checked: allergy.checked,
          opaqueIngredients: allergy.opaque,
          notice: ALLERGEN_NOTICE,
        },
        registeredAllergens: ctx.allergens, // 알레르기 미등록과 "검출 안 됨"을 구분하기 위함
        unsupportedDiseases: result.unsupportedDiseases,
        evaluatedDiseases: result.evaluatedDiseases,
        dailyReference: getDailyReference(user.gender, user.age),
        ...extra,
      },
    };
  }

  /** DB 식품(품목보고번호 또는 이름)을 분석한다. */
  async function analyzeDbFood(ctx, session, ref, source) {
    const record = await getFoodRecord(session, ref);
    if (!record) return null;
    const allergy = await analyzeFoodAllergens(
      session,
      { reportNo: record.meta.reportNo || undefined, foodName: record.meta.name },
      ctx.allergens,
    );
    return judge(ctx, session, {
      productName: record.meta.name,
      meta: record.meta,
      nutrition: record.nutrition,
      allergy,
      source,
    });
  }

  function send(res, outcome) {
    res.status(outcome.status).json(outcome.body);
  }

  function handleError(res, err, label) {
    if (MlServiceError && err instanceof MlServiceError) {
      console.error("ML 서비스 오류:", err.message, err.cause || "");
      return res.status(503).json({
        message: "분석 서비스(ML)에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.",
      });
    }
    if (err instanceof MlRequestError) {
      return res.status(err.status || 400).json({ message: err.message });
    }
    console.error(`${label} 오류:`, err);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }

  // ── GET /recommend/search?q=불닭 → 식품명 자동완성 ────────────
  router.get("/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) return res.json({ items: [] });
    if (q.length > MAX_FOOD_NAME_LENGTH) {
      return res.status(400).json({ message: "검색어가 너무 깁니다." });
    }

    const session = getSession();
    try {
      const items = await searchFoods(session, q, 10);
      res.json({ items });
    } catch (err) {
      handleError(res, err, "식품 검색");
    } finally {
      await session.close();
    }
  });

  // ── POST /recommend : DB 식품 분석 ───────────────────────────
  router.post("/", async (req, res) => {
    const foodName = typeof req.body?.foodName === "string" ? req.body.foodName.trim() : "";
    const reportNo = typeof req.body?.reportNo === "string" ? req.body.reportNo.trim() : "";

    if (!foodName && !reportNo) {
      return res.status(400).json({ message: "foodName은 필수입니다." });
    }
    if (foodName.length > MAX_FOOD_NAME_LENGTH || reportNo.length > 40) {
      return res.status(400).json({ message: "foodName이 너무 깁니다." });
    }

    let session;
    try {
      const ctx = await prepareUser(req, res);
      if (!ctx) return;

      session = getSession();
      const outcome = await analyzeDbFood(ctx, session, { reportNo, foodName }, "db");
      if (!outcome) return res.status(404).json({ message: "음식을 찾을 수 없습니다." });
      send(res, outcome);
    } catch (err) {
      handleError(res, err, "분석");
    } finally {
      if (session) await session.close();
    }
  });

  // ── 바코드: 번호 → 제품 → 분석 ────────────────────────────────
  async function analyzeBarcode(req, res, lookup, code) {
    // lookup: ML 서비스 응답 { status, code, report_no, product_name, manufacturer }
    if (lookup.status !== "ok") {
      const checksumHint = !hasValidCheckDigit(code)
        ? " 번호를 잘못 읽었을 수 있어요. 다시 스캔하거나 번호를 확인해주세요."
        : "";
      return res.status(200).json({
        status: "not_found",
        code,
        message: `등록되지 않은 바코드입니다.${checksumHint}`,
      });
    }

    const ctx = await prepareUser(req, res);
    if (!ctx) return;

    const session = getSession();
    try {
      const outcome = await analyzeDbFood(ctx, session, { reportNo: lookup.report_no }, "barcode");
      if (!outcome) {
        // 바코드로 제품은 확인했지만 영양성분 데이터가 없는 경우 → 영양성분표 촬영(OCR) 안내
        return res.status(200).json({
          status: "no_nutrition",
          code,
          reportNo: lookup.report_no,
          productName: lookup.product_name || null,
          manufacturer: lookup.manufacturer || null,
          message: "제품은 확인했지만 영양성분 정보가 아직 등록되지 않았습니다. 영양성분표를 촬영해 분석해 보세요.",
        });
      }
      if (outcome.body.userType !== "disease") return send(res, outcome);
      send(res, { status: outcome.status, body: { status: "ok", code, ...outcome.body } });
    } finally {
      await session.close();
    }
  }

  // POST /recommend/barcode { code }
  router.post("/barcode", async (req, res) => {
    const code = normalizeBarcode(req.body?.code);
    if (!isPlausibleBarcode(code)) {
      return res.status(400).json({ message: "바코드 번호는 8, 12, 13, 14자리 숫자여야 합니다." });
    }
    try {
      const lookup = await mlClient.barcodeLookup(code);
      await analyzeBarcode(req, res, lookup, code);
    } catch (err) {
      handleError(res, err, "바코드 분석");
    }
  });

  // POST /recommend/barcode/image  (multipart: image)
  router.post("/barcode/image", imageLimiter, upload.single("image"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "바코드 이미지를 첨부해주세요." });
    }
    try {
      const decoded = await mlClient.barcodeDecode(req.file);
      if (decoded.status === "decode_failed" || !decoded.code) {
        return res.status(200).json({
          status: "decode_failed",
          message: "바코드를 읽지 못했습니다. 바코드가 선명하게 보이도록 가까이서 다시 촬영하거나 번호를 직접 입력해주세요.",
        });
      }
      await analyzeBarcode(req, res, decoded, normalizeBarcode(decoded.code));
    } catch (err) {
      handleError(res, err, "바코드 이미지 분석");
    }
  });

  // ── POST /recommend/label : OCR/직접 입력 라벨 분석 ───────────
  router.post("/label", async (req, res) => {
    const { value, errors } = validateLabelInput(req.body);
    if (errors.length > 0) return res.status(400).json({ message: errors[0] });

    let session;
    try {
      const ctx = await prepareUser(req, res);
      if (!ctx) return;

      const { nutrition, factor, missing } = toPer100(value.nutrition, value.referenceAmount);
      const allergy = analyzeIngredientText({
        ingredientsText: value.ingredients,
        declared: value.declaredAllergens,
        cross: value.crossAllergens,
        userAllergens: ctx.allergens,
      });

      session = getSession();
      const outcome = await judge(ctx, session, {
        productName: value.productName || "촬영한 제품",
        meta: null,
        nutrition,
        allergy,
        source: "ocr",
        extra: {
          label: {
            referenceAmount: value.referenceAmount,
            normalizedTo: 100,
            factor: Math.round(factor * 1000) / 1000,
            missingNutrients: missing,
            hasIngredients: value.ingredients.trim().length > 0,
          },
        },
      });
      send(res, outcome);
    } catch (err) {
      handleError(res, err, "라벨 분석");
    } finally {
      if (session) await session.close();
    }
  });

  return router;
}

module.exports = createRecommendRouter;
