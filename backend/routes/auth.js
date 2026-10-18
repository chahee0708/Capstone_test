const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config");
const authMiddleware = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const { validateProfile, toColumnValues } = require("../services/profileService");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // bcrypt 는 72바이트 초과분을 무시한다

// 존재하지 않는 이메일로 로그인할 때도 bcrypt 비교를 수행해 응답 시간 차이로
// 계정 존재 여부를 알아내지 못하게 한다.
const DUMMY_HASH = bcrypt.hashSync("safebite-dummy-password", 10);

function signToken(user, type, expiresInSec) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, type },
    config.JWT_SECRET,
    { expiresIn: expiresInSec }
  );
}

function setAccessCookie(res, user) {
  res.cookie("accessToken", signToken(user, "access", config.ACCESS_TOKEN_TTL_SEC), {
    ...config.cookieOptions,
    maxAge: config.ACCESS_TOKEN_TTL_SEC * 1000,
  });
}

function setAuthCookies(res, user) {
  setAccessCookie(res, user);
  res.cookie("refreshToken", signToken(user, "refresh", config.REFRESH_TOKEN_TTL_SEC), {
    ...config.cookieOptions,
    maxAge: config.REFRESH_TOKEN_TTL_SEC * 1000,
  });
}

/**
 * @param {{ db: { execute: Function }, enableRateLimit?: boolean }} deps
 */
function createAuthRouter({ db, enableRateLimit = true }) {
  const router = express.Router();

  const passthrough = (req, res, next) => next();
  const loginLimiter = enableRateLimit
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.",
        keyFn: (req) => `${req.ip}|${String(req.body?.email || "").toLowerCase()}`,
      })
    : passthrough;
  const registerLimiter = enableRateLimit
    ? rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 20,
        message: "회원가입 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      })
    : passthrough;

  // POST /auth/register  { name, email, password, profile? }
  router.post("/register", registerLimiter, async (req, res) => {
    const { name, email, password, profile } = req.body || {};

    if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "name, email, password가 필요합니다." });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!name.trim() || !normalizedEmail || !password) {
      return res.status(400).json({ message: "name, email, password가 필요합니다." });
    }
    if (normalizedEmail.length > 255 || !EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ message: "올바른 이메일 형식이 아닙니다." });
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return res
        .status(400)
        .json({ message: `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자여야 합니다.` });
    }

    // 가입 시 함께 보낸 건강 프로필(선택) 검증
    const { value: profileValue, errors } = validateProfile({
      ...(profile && typeof profile === "object" ? profile : {}),
      name,
    });
    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0] });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const { columns, values } = toColumnValues({
        diseases: [],
        allergens: [],
        ...profileValue,
      });

      const [result] = await db.execute(
        `INSERT INTO users (email, password, ${columns.join(", ")})
         VALUES (?, ?, ${columns.map(() => "?").join(", ")})`,
        [normalizedEmail, hashedPassword, ...values]
      );

      const user = { id: result.insertId, email: normalizedEmail, name: profileValue.name };
      setAuthCookies(res, user);
      res.status(201).json({ user });
    } catch (err) {
      if (err && err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "이미 사용 중인 이메일입니다." });
      }
      console.error("Register error:", err);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
    }
  });

  // POST /auth/login  { email, password }
  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({ message: "email과 password가 필요합니다." });
    }

    try {
      const [rows] = await db.execute(
        "SELECT id, name, email, password FROM users WHERE email = ?",
        [email.trim().toLowerCase()]
      );
      const found = rows[0];
      const isMatch = await bcrypt.compare(password, found ? found.password : DUMMY_HASH);
      if (!found || !isMatch) {
        return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
      }

      const user = { id: found.id, name: found.name, email: found.email };
      setAuthCookies(res, user);
      res.json({ user });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
    }
  });

  // POST /auth/refresh  (refreshToken 쿠키로 accessToken 재발급)
  router.post("/refresh", async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ message: "리프레시 토큰이 없습니다." });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "유효하지 않은 리프레시 토큰입니다." });
    }
    if (decoded.type !== "refresh") {
      return res.status(401).json({ message: "유효하지 않은 리프레시 토큰입니다." });
    }

    try {
      // 탈퇴/삭제된 계정이면 재발급하지 않고, 최신 이름을 토큰에 반영한다.
      const [rows] = await db.execute("SELECT id, name, email FROM users WHERE id = ?", [
        decoded.id,
      ]);
      if (rows.length === 0) {
        return res.status(401).json({ message: "유효하지 않은 리프레시 토큰입니다." });
      }
      setAccessCookie(res, rows[0]);
      res.json({ message: "토큰이 갱신되었습니다." });
    } catch (err) {
      console.error("Refresh error:", err);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
    }
  });

  // POST /auth/logout
  router.post("/logout", (req, res) => {
    res.clearCookie("accessToken", config.cookieOptions);
    res.clearCookie("refreshToken", config.cookieOptions);
    res.json({ message: "로그아웃 되었습니다." });
  });

  // GET /auth/me
  router.get("/me", authMiddleware, async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT id, name, email FROM users WHERE id = ?", [
        req.user.id,
      ]);
      if (rows.length === 0) {
        return res.status(401).json({ message: "사용자를 찾을 수 없습니다." });
      }
      res.json({ user: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
    } catch (err) {
      console.error("Me error:", err);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
    }
  });

  return router;
}

module.exports = createAuthRouter;
