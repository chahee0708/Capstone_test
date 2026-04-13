const express = require("express");
const router = express.Router();

const { getConnection }        = require("../db/mysql");
const { getSession }           = require("../db/neo4j");
const { scoreForDiseaseUser, scoreForHealthyUser } = require("../services/scoreService");
const { checkAllergens }       = require("../services/allergyService");

router.post("/", async (req, res) => {
  const { foodName, userId } = req.body;

  if (!foodName || !userId) {
    return res.status(400).json({ message: "foodName과 userId는 필수입니다." });
  }

  const session = getSession();

  try {
    // 1. MySQL에서 사용자 정보 조회
    const db = await getConnection();
    const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [userId]);
    await db.end();

    if (rows.length === 0) {
      return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    }

    const user      = rows[0];
    const diseases  = JSON.parse(user.diseases  || "[]");
    const allergens = JSON.parse(user.allergens  || "[]");
    const hasDiseases = diseases.length > 0;

    // 2. 케이스 분기: 질병 있음 / 없음
    let result;
    if (hasDiseases) {
      result = await scoreForDiseaseUser(
        session, foodName, diseases, user.weight, user.height, user.age
      );
    } else {
      result = await scoreForHealthyUser(
        session, foodName, user.weight, user.height, user.age
      );
    }

    if (!result) {
      return res.status(404).json({ message: "음식을 찾을 수 없습니다." });
    }

    // 3. 알레르기 체크 (점수와 무관하게 별도 표시)
    const foundAllergens = await checkAllergens(session, foodName, allergens);

    const { score, warnings, nutrition, bmi, t2dRisk } = result;
    const rating =
      score >= 80 ? "recommended" : score >= 60 ? "warning" : "not-recommended";

    res.json({
      productName:  foodName,
      userType:     hasDiseases ? "disease" : "healthy",
      score,
      rating,
      bmi,
      nutrition,
      warnings,
      allergenAlert: foundAllergens,
      t2dRisk:      t2dRisk || null,
      aiAnalysis:   `${foodName} 분석 완료. 건강 점수: ${score}점`,
    });

  } catch (err) {
    res.status(500).json({ message: "서버 오류", error: err.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
