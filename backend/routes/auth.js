const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getConnection } = require("../db/mysql");
const authMiddleware = require("../middleware/auth");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "safebite-secret-key";

// POST /auth/register
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "name, email, password가 필요합니다." });
  }

  // 이메일 형식 검증
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "올바른 이메일 형식이 아닙니다." });
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
    const accessToken = jwt.sign({ id: userId, email, name }, JWT_SECRET, { expiresIn: "1h" });
    const refreshToken = jwt.sign({ id: userId, email, name }, JWT_SECRET, { expiresIn: "7d" });

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: false, // HTTPS 환경에서는 true로 설정해야 함
      maxAge: 3600000 // 1시간
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: false, // HTTPS 환경에서는 true로 설정해야 함
      maxAge: 7 * 24 * 3600 * 1000 // 7일
    });

    res.status(201).json({
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

    const accessToken = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const refreshToken = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: false,
      maxAge: 3600000
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: false,
      maxAge: 7 * 24 * 3600 * 1000
    });

    res.json({
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

// POST /auth/refresh
router.post("/refresh", (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ message: "리프레시 토큰이 없습니다." });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    
    // 새로운 access token 발급
    const accessToken = jwt.sign(
      { id: decoded.id, email: decoded.email, name: decoded.name },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: false,
      maxAge: 3600000
    });

    res.json({ message: "토큰이 갱신되었습니다." });
  } catch (err) {
    res.status(401).json({ message: "유효하지 않은 리프레시 토큰입니다." });
  }
});

// POST /auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
  res.json({ message: "로그아웃 되었습니다." });
});

// GET /auth/me
router.get("/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});
