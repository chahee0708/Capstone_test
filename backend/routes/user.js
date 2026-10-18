/**
 * user.js
 *
 * 역할: 로그인한 사용자의 프로필 조회/수정
 *
 *   GET /users/me, GET /users/:id  → 프로필 반환 (질병 심각도 컬럼 포함)
 *   PUT /users/me, PUT /users/:id  → 프로필 수정 (요청에 포함된 필드만 갱신)
 *
 * 보안: :id 는 로그인한 사용자 본인(req.user.id)일 때만 허용한다.
 *       (다른 사용자의 건강 정보 조회/수정 방지)
 */

const express = require("express");
const {
  validateProfile,
  toColumnValues,
  toPublicProfile,
} = require("../services/profileService");

/**
 * 경로의 :id 를 본인 id 로 해석한다. 본인이 아니면 null.
 */
function resolveOwnId(req) {
  const { id } = req.params;
  if (id === "me") return req.user.id;
  if (!/^\d+$/.test(id)) return null;
  return Number(id) === Number(req.user.id) ? Number(id) : null;
}

/**
 * @param {{ db: { execute: Function } }} deps
 */
function createUserRouter({ db }) {
  const router = express.Router();

  router.get("/:id", async (req, res) => {
    const userId = resolveOwnId(req);
    if (userId === null) {
      return res.status(403).json({ message: "본인의 정보만 조회할 수 있습니다." });
    }

    try {
      const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [userId]);
      if (rows.length === 0) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
      }
      res.json(toPublicProfile(rows[0]));
    } catch (err) {
      console.error("GET /users/:id 오류:", err);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
    }
  });

  router.put("/:id", async (req, res) => {
    const userId = resolveOwnId(req);
    if (userId === null) {
      return res.status(403).json({ message: "본인의 정보만 수정할 수 있습니다." });
    }

    const { value, errors } = validateProfile(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0] });
    }

    const { columns, values } = toColumnValues(value);
    if (columns.length === 0) {
      return res.status(400).json({ message: "수정할 항목이 없습니다." });
    }

    try {
      // columns 는 profileService 의 화이트리스트에서만 나오므로 SQL 조각으로 사용해도 안전하다.
      const [result] = await db.execute(
        `UPDATE users SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
        [...values, userId]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
      }
      res.json({ message: "저장 완료" });
    } catch (err) {
      console.error("PUT /users/:id 오류:", err);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
    }
  });

  return router;
}

module.exports = createUserRouter;
