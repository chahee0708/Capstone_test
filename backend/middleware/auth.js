const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config");

/**
 * accessToken 쿠키를 검증해 req.user = { id, email, name } 을 채운다.
 * refresh 토큰으로 API 를 호출하지 못하도록 type 클레임을 확인한다.
 */
function authMiddleware(req, res, next) {
  const token = req.cookies?.accessToken;
  if (!token) {
    return res.status(401).json({ message: "인증 토큰이 없습니다." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== "access") {
      return res.status(401).json({ message: "유효하지 않은 토큰입니다." });
    }
    req.user = { id: decoded.id, email: decoded.email, name: decoded.name };
    next();
  } catch {
    return res.status(401).json({ message: "유효하지 않은 토큰입니다." });
  }
}

module.exports = authMiddleware;
