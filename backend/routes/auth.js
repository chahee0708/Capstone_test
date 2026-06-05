const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getConnection } = require("../db/mysql");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "safebite-secret-key";

// POST /auth/register
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "name, email, password가 필요합니다." });
  }

  let conn;
  try {
    conn = await getConnection();
    const [existing] = await conn.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: "이미 사용 중인 이메일입니다." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await conn.execute(
      "INSERT INTO users (name, email, password, diseases, allergens) VALUES (?, ?, ?, '[]', '[]')",
      [name, email, hashedPassword]
    );

    const userId = result.insertId;
    const token = jwt.sign({ id: userId, email, name }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({
      token,
      user: { id: userId, name, email },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  } finally {
    if (conn) await conn.end();
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "email과 password가 필요합니다." });
  }

  let conn;
  try {
    conn = await getConnection();
    const [rows] = await conn.execute("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  } finally {
    if (conn) await conn.end();
  }
});

module.exports = router;
