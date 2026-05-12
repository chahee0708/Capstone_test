const express = require("express");
const router = express.Router();
const { getConnection } = require("../db/mysql");

// 사용자 프로필 조회
router.get("/:id", async (req, res) => {
  try {
    const db = await getConnection();
    const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [
      req.params.id,
    ]);
    await db.end();

    if (rows.length === 0)
      return res.status(404).json({ message: "사용자 없음" });

    const user = rows[0];
    user.diseases = Array.isArray(user.diseases)
      ? user.diseases
      : JSON.parse(user.diseases || "[]");
    user.allergens = Array.isArray(user.allergens)
      ? user.allergens
      : JSON.parse(user.allergens || "[]");
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

//사용자 프로필 수정
router.put("/:id", async (req, res) => {
  const { name, age, gender, weight, height, diseases, allergens } = req.body;
  try {
    const db = await getConnection();
    await db.execute(
      "UPDATE users SET name=?, age=?, gender=?, weight=?, height=?, diseases=?, allergens=? WHERE id=?",
      [
        name,
        age,
        gender,
        weight,
        height,
        JSON.stringify(diseases),
        JSON.stringify(allergens),
        req.params.id,
      ],
    );
    await db.end();
    res.json({ message: "저장 완료" });
  } catch (err) {
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

module.exports = router;
