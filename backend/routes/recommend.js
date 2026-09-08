/**
 * recommend.js
 *
 * 역할: POST /recommend 엔드포인트 처리
 *
 * 처리 흐름:
 *   1. 요청에서 foodName, userId 추출
 *   2. MySQL에서 사용자 정보 조회
 *      (diseases, allergens, 신체정보, 성별, 질병 심각도 컬럼 포함)
 *   3. 질병 있음 → scoreForDiseaseUser로 판정
 *      질병 없음 → scoreForHealthyUser로 판정 (KDRI/WHO 일반인 기준)
 *   4. 알레르기 있는 유저만 allergyService 호출
 *   5. 최종 JSON 응답 (dailyReference 포함)
 */

const express = require("express");
const router = express.Router();

const { getConnection } = require("../db/mysql");
const { getSession } = require("../db/neo4j");
const {
  scoreForDiseaseUser,
  scoreForHealthyUser,
  getDailyReference,
} = require("../services/scoreService");
const { checkAllergens } = require("../services/allergyService");

router.post("/", async (req, res) => {
  const { foodName, userId } = req.body;

  if (!foodName || !userId) {
    return res.status(400).json({ message: "foodName과 userId는 필수입니다." });
  }

  const session = getSession();

  try {
    // ── Step 1. MySQL에서 사용자 정보 조회 ────────────────────
    const db = await getConnection();
    const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [
      userId,
    ]);
    await db.end();

    if (rows.length === 0) {
      return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    }

    const user = rows[0];

    const diseases = Array.isArray(user.diseases)
      ? user.diseases.map((d) => d.trim())
      : JSON.parse(user.diseases || "[]").map((d) => d.trim());

    const allergens = Array.isArray(user.allergens)
      ? user.allergens.map((a) => a.trim())
      : JSON.parse(user.allergens || "[]").map((a) => a.trim());

    // 디버그 로그
    console.log("diseases:", diseases);
    console.log("hypertension_stage:", user.hypertension_stage);
    console.log("ldl_level:", user.ldl_level);
    console.log("gfr_value:", user.gfr_value);

    const hasDiseases = diseases.length > 0;

    // ── Step 2. 건강한 사용자(질병 없음) 트랙 ────────────────
    if (!hasDiseases) {
      const healthyResult = await scoreForHealthyUser(
        session,
        foodName,
        user.weight,
        user.height,
        user.age,
        user.gender,
      );

      if (!healthyResult) {
        return res.status(404).json({ message: "음식을 찾을 수 없습니다." });
      }

      const healthyAllergens =
        allergens.length > 0
          ? await checkAllergens(session, foodName, allergens)
          : [];

      return res.json({
        productName: foodName,
        userType: "healthy",
        diseaseTrack: healthyResult.diseaseTrack, // "healthy"
        verdict: healthyResult.verdict, // "추천" | "주의" | "비추천"
        giCategory: null,
        bmi: healthyResult.bmi,
        bmiCategory: healthyResult.bmiCategory, // "저체중"|"정상"|"과체중"|"비만"
        nutrition: healthyResult.nutrition,
        warnings: healthyResult.warnings,
        highlights: healthyResult.highlights, // 긍정 영양소 안내
        allergenAlert: healthyAllergens,
        dailyReference: getDailyReference(user.gender, user.age),
      });
    }

    // ── Step 3. 질병 심각도 정보 묶음 ─────────────────────────
    // scoreService로 한꺼번에 전달
    const diseaseDetails = {
      hypertension_stage: user.hypertension_stage || 1,
      ldl_level: user.ldl_level || "high",
      gfr_value: user.gfr_value !== null ? user.gfr_value : 35,
    };

    // ── Step 4. scoreService로 판정 ───────────────────────────
    const result = await scoreForDiseaseUser(
      session,
      foodName,
      diseases,
      user.weight,
      user.height,
      user.age,
      user.gender,
      diseaseDetails,
    );

    if (!result) {
      return res.status(404).json({ message: "음식을 찾을 수 없습니다." });
    }

    // ── Step 5. 알레르기 체크 ──────────────────────────────────
    const foundAllergens =
      allergens.length > 0
        ? await checkAllergens(session, foodName, allergens)
        : [];

    // ── Step 6. KDRI 1일 기준값 → 프론트 차트 max값에 사용 ────
    const dailyReference = getDailyReference(user.gender, user.age);

    // ── Step 7. 최종 응답 ──────────────────────────────────────
    res.json({
      productName: foodName,
      userType: "disease",
      diseaseTrack: result.diseaseTrack, // "diabetes" | "rule"
      verdict: result.verdict, // "추천" | "주의" | "비추천"
      giCategory: result.giCategory, // ML 트랙: "Low"|"Medium"|"High", 규칙: null
      bmi: result.bmi,
      nutrition: result.nutrition,
      warnings: result.warnings,
      allergenAlert: foundAllergens,
      dailyReference,
    });
  } catch (err) {
    console.error("서버 오류:", err);
    res.status(500).json({ message: "서버 오류", error: err.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
