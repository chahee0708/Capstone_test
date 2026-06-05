const express = require("express");
const router = express.Router();
const { getConnection } = require("../db/mysql");

// GET /history  → 로그인 유저의 검색기록 반환 (최신순 50건)
router.get("/", async (req, res) => {
  const userId = req.user.id;

  try {
    const db = await getConnection();
    const [rows] = await db.execute(
      `SELECT id, food_name, verdict, searched_at
         FROM search_history
        WHERE user_id = ?
        ORDER BY searched_at DESC
        LIMIT 50`,
      [userId]
    );
    await db.end();
    res.json(rows);
  } catch (err) {
    console.error("GET /history 오류:", err);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

module.exports = router;
