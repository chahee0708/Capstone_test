/**
 * rateLimit.js
 *
 * 외부 의존성 없는 고정 윈도우 방식 요청 제한 미들웨어.
 * 로그인/회원가입 무차별 대입 공격 완화용이며, 단일 프로세스(메모리) 기준이다.
 * 서버를 여러 대로 확장하면 Redis 등 공유 저장소 기반으로 교체해야 한다.
 */

function rateLimit({ windowMs, max, message, keyFn }) {
  const hits = new Map(); // key -> { count, resetAt }

  const middleware = (req, res, next) => {
    const now = Date.now();
    const key = keyFn ? keyFn(req) : req.ip;

    // 만료된 항목 정리 (맵이 무한히 커지지 않도록)
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) hits.delete(k);
      }
    }

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        message: message || "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      });
    }
    next();
  };

  middleware.reset = () => hits.clear();
  return middleware;
}

module.exports = rateLimit;
