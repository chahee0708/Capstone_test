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
 *   5. 알레르기 성분이 1개 이상이면 최종 verdict 를 "비추천" 으로 강제
 *   6. 최종 판정이 주의/비추천이면 대체음식 추천 (alternativeService)
 *   7. 최종 JSON 응답 (dailyReference 포함)
 *
 * 호출: index.js 에서 app.use("/recommend", authMiddleware, recommendRouter)
 *       → 프론트 분석 페이지가 POST /recommend, 자동완성이 GET /recommend/search 호출
 *
 * ── 이번 변경(알레르기 정보 없음 안내) ─────────────────────────
 *   - [추가] allergyUnknown: 사용자 알레르기가 있는데 원래 음식에 알레르기 정보(CONTAINS_ALLERGEN)가
 *     하나도 없으면 true (verdict 는 바꾸지 않음) → 프론트 판정 카드에 회색 안내
 *     단, 원재료 이름으로 알레르기 성분이 이미 확인된 경우(allergens 1개 이상)는 false
 *     (이미 "알레르기 성분 포함" 으로 비추천이므로 "정보 없음" 안내와 겹치지 않게)
 *
 * ── 이전 변경(대체음식 추천) ──────────────────────────────────
 *   - 최종 판정이 끝난 뒤 findAlternatives 호출 → 응답에 alternatives 필드 추가
 *       최종 verdict 가 "주의"/"비추천" 일 때만 필드를 넣는다 ("추천" 이면 필드 자체가 없음 → 프론트 섹션 숨김)
 *       대체음식 처리에서 예외가 나도 분석 응답은 실패시키지 않고 alternatives: [] 로 보낸다
 *       처리 시간(ms)을 서버 로그에 출력
 *   - diseaseDetails 를 if 블록 밖으로 옮김 (대체음식 후보 재판정에도 같은 값을 넘기기 위해)
 *   - 기존 응답 필드는 이름·형식 그대로
 *
 * ── 이전 변경(알레르기 우선 규칙) ─────────────────────────────
 *   - 알레르기 성분이 있으면 질환/ML/무질환 판정과 관계없이 verdict = "비추천"
 *   - 응답 필드 추가 (기존 필드 이름·형식은 그대로)
 *       allergens        : 걸린 알레르기 이름 배열 (없으면 [])
 *       allergyOverride  : 알레르기 규칙이 적용됐는지 (allergens 가 1개 이상이면 true)
 *                          영양 판정이 이미 "비추천" 이었어도 알레르기가 있으면 true
 *       nutritionVerdict : 알레르기 적용 전 영양 판정 ("추천"|"주의"|"비추천")
 *   - allergenAlert 는 호환성을 위해 그대로 유지 (allergens 와 같은 값)
 *
 * ── 이전 변경(STEP 1) ────────────────────────────────────────
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
const { checkAllergens, hasAllergenInfo } = require("../services/allergyService");
const { findAlternatives } = require("../services/alternativeService");

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
    console.log("tg_value:", user.tg_value);
    console.log("hdl_value:", user.hdl_value);
    console.log("gfr_value:", user.gfr_value);

    const hasDiseases = diseases.length > 0;

    // 질병 심각도 정보 묶음 → scoreService로 한꺼번에 전달
    // [변경] if 블록 밖으로 이동: 대체음식 후보 재판정에도 같은 값을 쓴다 (값 계산은 그대로)
    const diseaseDetails = {
      hypertension_stage: user.hypertension_stage || 1,
      ldl_value: user.ldl_value ?? null,
      tg_value: user.tg_value ?? null,
      hdl_value: user.hdl_value ?? null,
      gfr_value: user.gfr_value !== null ? user.gfr_value : 35,
    };

    // ── Step 2~4. scoreService로 판정 ─────────────────────────
    let result;

    if (hasDiseases) {
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

    // ── Step 5-1. 알레르기 우선 규칙 ──────────────────────────
    // 영양 판정 결과는 nutritionVerdict 로 따로 보관하고,
    // 알레르기 성분이 1개라도 있으면 최종 verdict 를 "비추천" 으로 덮어쓴다
    const nutritionVerdict = result.verdict;
    const allergyOverride = foundAllergens.length > 0;
    const finalVerdict = allergyOverride ? "비추천" : nutritionVerdict;

    // [추가] 알레르기 정보 없음: 사용자 알레르기 있음 + 음식에 CONTAINS_ALLERGEN 없음 + 걸린 성분 없음
    //        판정(verdict)은 그대로 두고 안내 플래그만 보낸다
    const allergyUnknown =
      allergens.length > 0 &&
      foundAllergens.length === 0 &&
      !(await hasAllergenInfo(session, foodName));

    // ── Step 5-2. 대체음식 추천 (최종 판정이 주의/비추천일 때만) ──────
    // alternatives 가 undefined 면 응답에 필드를 넣지 않는다 → 프론트에서 섹션이 안 보임
    let alternatives;
    if (finalVerdict === "주의" || finalVerdict === "비추천") {
      const startedAt = Date.now();
      try {
        alternatives = await findAlternatives(
          session,
          foodName,
          {
            diseases,
            allergens,
            weight: user.weight,
            height: user.height,
            age: user.age,
            gender: user.gender,
            diseaseDetails,
          },
          {
            verdict: finalVerdict,
            nutritionVerdict,
            allergyOverride,
            reasons: result.reasons,
            nutrition: result.nutrition,
          },
        );
      } catch (err) {
        // 대체음식 때문에 분석 응답 전체가 실패하면 안 된다 → 빈 배열로 보내고 로그만
        console.error("[대체음식] 처리 실패:", err);
        alternatives = [];
      }
      console.log(
        `[대체음식] ${foodName}: ${alternatives.length}개, ${Date.now() - startedAt}ms`,
      );
    }

    // ── Step 6. KDRI 1일 기준값 → 프론트 가로 막대 차트 max값에 사용 ────
    // 탄수화물만 "권장섭취량 130g" 대신 "에너지적정비율 상한(65%)" 값이 들어온다
    const dailyReference = getDisplayDailyReference(user.gender, user.age);

    // ── Step 7. 최종 응답 ──────────────────────────────────────
    res.json({
      productName: foodName,
      userType: hasDiseases ? "disease" : "healthy",
      diseaseTrack: result.diseaseTrack, // "diabetes" | "rule" | "healthy"
      verdict: finalVerdict, // "추천" | "주의" | "비추천" (알레르기 있으면 항상 "비추천")
      nutritionVerdict, // 알레르기 적용 전 영양 판정
      giCategory: result.giCategory, // ML 트랙: "Low"|"Medium"|"High", 규칙: null
      bmi: result.bmi,
      nutrition: result.nutrition,
      warnings: result.warnings, // 호환성 유지용 (화면에서는 reasons를 대신 사용)
      reasons: result.reasons, // 판정 근거 줄글용 (VerdictExplanation.tsx)
      radar: result.radar, // 방사형 그래프용 6축 (NutrientRadarChart.tsx)
      carbInfo: result.carbInfo, // 1형 당뇨 사용자에게만 값이 들어옴
      allergenAlert: foundAllergens, // 호환성 유지용 (allergens 와 같은 값)
      allergens: foundAllergens, // 걸린 알레르기 이름 배열 (없으면 [])
      allergyOverride, // 알레르기 때문에 "비추천" 으로 강제됐는지
      allergyUnknown, // [추가] 알레르기 정보가 없어 확인이 필요한지 (판정에는 영향 없음)
      dailyReference,
      // 대체음식: 최종 판정이 주의/비추천일 때만 필드가 생긴다
      ...(alternatives !== undefined && { alternatives }),
    });
  } catch (err) {
    console.error("서버 오류:", err);
    res.status(500).json({ message: "서버 오류", error: err.message });
  } finally {
    await session.close();
  }
});

// ── GET /recommend/search?q=초코 ─────────────────────────────
// 제품명에 입력한 글자가 들어간 음식 이름을 최대 10개 반환 (자동완성용)
router.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);

  const session = getSession();
  try {
    const result = await session.run(
      `MATCH (f:Food) WHERE f.name CONTAINS $q
       RETURN f.name AS name
       ORDER BY size(f.name) ASC
       LIMIT 10`,
      { q },
    );
    res.json(result.records.map((r) => r.get("name")));
  } catch (err) {
    console.error("검색 오류:", err);
    res.status(500).json({ message: "검색 오류", error: err.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
