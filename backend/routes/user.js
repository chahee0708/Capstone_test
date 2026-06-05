/**
 * user.js
 *
 * 역할: GET/PUT /users/:id 엔드포인트
 *
 * GET /users/:id  → 사용자 정보 반환 (질병 심각도 컬럼 포함)
 * PUT /users/:id  → 사용자 정보 업데이트 (질병 심각도 컬럼 포함)
 */

const express = require("express");
const router  = express.Router();
const { getConnection } = require("../db/mysql");

// ── GET /users/:id ────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const db = await getConnection();
    const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [id]);
    await db.end();

    if (rows.length === 0) {
      return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    }

    const user = rows[0];

    // diseases, allergens JSON 파싱
    const diseases  = Array.isArray(user.diseases)
      ? user.diseases
      : JSON.parse(user.diseases  || "[]");
    const allergens = Array.isArray(user.allergens)
      ? user.allergens
      : JSON.parse(user.allergens || "[]");

    res.json({
      id:                 user.id,
      name:               user.name,
      age:                user.age,
      weight:             user.weight,
      height:             user.height,
      gender:             user.gender,
      diseases,
      allergens,
      // 질병 심각도 필드
      hypertension_stage: user.hypertension_stage ?? 1,
      ldl_value:          user.ldl_value  ?? null,
      tg_value:           user.tg_value   ?? null,
      hdl_value:          user.hdl_value  ?? null,
      gfr_value:          user.gfr_value  ?? 35,
    });

  } catch (err) {
    console.error("GET /users/:id 오류:", err);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

// ── PUT /users/:id ────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    name, age, weight, height, gender,
    diseases, allergens,
    hypertension_stage,
    ldl_value, tg_value, hdl_value,
    gfr_value,
  } = req.body;

  try {
    const db = await getConnection();

    await db.execute(
      `UPDATE users SET
        name               = ?,
        age                = ?,
        weight             = ?,
        height             = ?,
        gender             = ?,
        diseases           = ?,
        allergens          = ?,
        hypertension_stage = ?,
        ldl_value          = ?,
        tg_value           = ?,
        hdl_value          = ?,
        gfr_value          = ?
       WHERE id = ?`,
      [
        name,
        age,
        weight,
        height,
        gender,
        JSON.stringify(diseases  || []),
        JSON.stringify(allergens || []),
        hypertension_stage ?? 1,
        ldl_value ?? null,
        tg_value  ?? null,
        hdl_value ?? null,
        gfr_value ?? 35,
        id,
      ]
    );

    await db.end();
    res.json({ message: "저장 완료" });

  } catch (err) {
    console.error("PUT /users/:id 오류:", err);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

module.exports = router;