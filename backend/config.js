/**
 * config.js
 *
 * 환경변수 기반 설정을 한 곳에서 관리한다.
 * - JWT_SECRET 은 소스에 하드코딩하지 않는다.
 *   운영(NODE_ENV=production)에서 누락되면 서버 시작을 거부하고,
 *   개발에서 누락되면 프로세스마다 임의 시크릿을 생성한다(재시작 시 기존 로그인 무효화).
 */

const crypto = require("crypto");

const isProduction = process.env.NODE_ENV === "production";

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (isProduction) {
    throw new Error("JWT_SECRET 환경변수가 설정되지 않았습니다.");
  }

  console.warn(
    "[config] JWT_SECRET 이 설정되지 않아 임시 시크릿을 생성합니다. " +
      "서버를 재시작하면 기존 로그인이 모두 만료됩니다."
  );
  return crypto.randomBytes(48).toString("hex");
}

const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1시간
const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7일

let cachedJwtSecret = null;

module.exports = {
  isProduction,
  // 인증 코드가 처음 사용할 때 한 번만 결정한다 (ML 설정만 쓰는 모듈이 경고를 내지 않도록).
  get JWT_SECRET() {
    if (cachedJwtSecret === null) cachedJwtSecret = resolveJwtSecret();
    return cachedJwtSecret;
  },
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",
  PORT: Number(process.env.PORT) || 4000,
  ML_SERVICE_URL: process.env.ML_SERVICE_URL || "http://ml:8000",
  ML_TIMEOUT_MS: Number(process.env.ML_TIMEOUT_MS) || 5000,
  // OCR/바코드 이미지 처리는 예측 호출보다 오래 걸린다
  ML_OCR_TIMEOUT_MS: Number(process.env.ML_OCR_TIMEOUT_MS) || 90000,
  // 업로드 이미지 제한 (장당 바이트, 최대 장수)
  UPLOAD_MAX_BYTES: Number(process.env.UPLOAD_MAX_BYTES) || 12 * 1024 * 1024,
  UPLOAD_MAX_FILES: 4,
  // 쿠키 공통 옵션: HTTPS 환경(운영)에서는 secure 를 켠다.
  cookieOptions: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : isProduction,
    sameSite: "lax",
  },
};
