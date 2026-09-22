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
 *      질병 없음 → scoreForHealthyUser로 판정 (KDRI 일반인 기준치)
 *   4. 알레르기 있는 유저만 allergyService 호출
 *   5. 최종 JSON 응답 (dailyReference 포함)
 *
 * ── 이번 변경(STEP 1) ────────────────────────────────────────
 *   - 응답에 radar(방사형 그래프용), reasons(판정 근거 줄글용), carbInfo(1형 당뇨용) 추가
 *   - dailyReference를 getDailyReference → getDisplayDailyReference로 교체
 *     (탄수화물 기준만 130g → 에너지×65%÷4 로 바뀐다. 판정값은 그대로)
 *   - 기존 warnings 필드는 호환성을 위해 그대로 유지 (화면에서는 더 이상 쓰지 않음)
 */

const express = require("express");
const router = express.Router();

const { getConnection } = require("../db/mysql");
const { getSession } = require("../db/neo4j");
const {
  scoreForDiseaseUser,
  scoreForHealthyUser,
  getDisplayDailyReference,
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
    console.log("ldl_value:", user.ldl_value);
    console.log("tg_value:",  user.tg_value);
    console.log("hdl_value:", user.hdl_value);
    console.log("gfr_value:", user.gfr_value);

    const hasDiseases = diseases.length > 0;

    // ── Step 2~4. scoreService로 판정 ─────────────────────────
    let result;

    if (hasDiseases) {
      // 질병 심각도 정보 묶음 → scoreService로 한꺼번에 전달
      const diseaseDetails = {
        hypertension_stage: user.hypertension_stage || 1,
        ldl_value: user.ldl_value ?? null,
        tg_value:  user.tg_value  ?? null,
        hdl_value: user.hdl_value ?? null,
        gfr_value: user.gfr_value !== null ? user.gfr_value : 35,
      };

      result = await scoreForDiseaseUser(
        session,
        foodName,
        diseases,
        user.weight,
        user.height,
        user.age,
        user.gender,
        diseaseDetails,
      );
    } else {
      // 무질환 사용자 → KDRI 일반인 기준치로 판정
      result = await scoreForHealthyUser(
        session,
        foodName,
        user.weight,
        user.height,
        user.age,
        user.gender,
      );
    }

    if (!result) {
      return res.status(404).json({ message: "음식을 찾을 수 없습니다." });
    }

    // ── Step 5. 알레르기 체크 ──────────────────────────────────
    const foundAllergens =
      allergens.length > 0
        ? await checkAllergens(session, foodName, allergens)
        : [];

    // ── Step 6. KDRI 1일 기준값 → 프론트 가로 막대 차트 max값에 사용 ────
    // 탄수화물만 "권장섭취량 130g" 대신 "에너지적정비율 상한(65%)" 값이 들어온다
    const dailyReference = getDisplayDailyReference(user.gender, user.age);

    // ── Step 7. 최종 응답 ──────────────────────────────────────
    res.json({
      productName: foodName,
      userType: hasDiseases ? "disease" : "healthy",
      diseaseTrack: result.diseaseTrack, // "diabetes" | "rule" | "healthy"
      verdict: result.verdict, // "추천" | "주의" | "비추천"
      giCategory: result.giCategory, // ML 트랙: "Low"|"Medium"|"High", 규칙: null
      bmi: result.bmi,
      nutrition: result.nutrition,
      warnings: result.warnings, // 호환성 유지용 (화면에서는 reasons를 대신 사용)
      reasons: result.reasons, // 판정 근거 줄글용 (VerdictExplanation.tsx)
      radar: result.radar, // 방사형 그래프용 6축 (NutrientRadarChart.tsx)
      carbInfo: result.carbInfo, // 1형 당뇨 사용자에게만 값이 들어옴
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
