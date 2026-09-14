const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "safebite-secret-key";

function authMiddleware(req, res, next) {
  const token = req.cookies?.accessToken;
  if (!token) {
    return res.status(401).json({ message: "인증 토큰이 없습니다." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "유효하지 않은 토큰입니다." });
  }
}

module.exports = authMiddleware;
