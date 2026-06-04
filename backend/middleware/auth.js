const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "safebite-secret-key";

function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "인증 토큰이 없습니다." });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "유효하지 않은 토큰입니다." });
  }
}

module.exports = authMiddleware;
