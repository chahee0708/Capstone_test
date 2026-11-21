/**
 * myFoods.js
 *
 * 역할: 로그인한 사용자의 "관심 식품"과 "최근 검색한 식품"
 *   프로필 화면의 "내 식품" 탭과 홈 결과 화면의 하트 버튼이 쓴다.
 *   사용자는 토큰(req.user.id)으로 정한다. 다른 사람 목록은 볼 수 없다.
 *
 * 엔드포인트 (index.js 에서 /me 아래, authMiddleware 뒤에 붙인다)
 *   GET    /me/foods                 → { favorites: [...], recent: [...] }  (최근 검색은 최신 20개)
 *   POST   /me/favorites             { name, category } → 관심 식품에 추가 (이미 있으면 그대로)
 *   DELETE /me/favorites/:name       → 관심 식품에서 삭제
 *   DELETE /me/recent                → 최근 검색 전체 삭제
 *   각 항목: { name, category, source, labelData, at }   at = 추가/검색한 시각 (ISO 문자열)
 *     source "db": 식품명 검색 / "label": 사진으로 읽은 라벨. labelData 에 다시 분석할 값
 *     (제품명, 100g당 영양성분, 원재료, 함유·혼입 알레르기, 기준량). 프로필에서 누르면 이 값으로 POST /recommend/label
 *   POST /me/favorites { name, category, source?, labelData? } / DELETE /me/favorites/:name?source=label
 *
 * 최근 검색은 POST /recommend 가 성공할 때 recordRecentSearch 로 남긴다 (routes/recommend.js)
 *
 * 테이블: 서버가 켜질 때 ensureMyFoodTables 로 만든다 (init.sql 은 DB 를 처음 만들 때만 실행되므로)
 */

const express = require("express");
const router = express.Router();
const { getConnection } = require("../db/mysql");

const RECENT_LIMIT = 20;

const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS user_favorites (
     user_id    INT          NOT NULL,
     food_name  VARCHAR(255) NOT NULL,
     category   VARCHAR(50)  DEFAULT NULL,
     source     VARCHAR(10)  NOT NULL DEFAULT 'db',
     label_data JSON         DEFAULT NULL,
     created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (user_id, food_name, source)
   ) DEFAULT CHARSET = utf8mb4`,
  `CREATE TABLE IF NOT EXISTS user_recent_searches (
     user_id     INT          NOT NULL,
     food_name   VARCHAR(255) NOT NULL,
     category    VARCHAR(50)  DEFAULT NULL,
     source      VARCHAR(10)  NOT NULL DEFAULT 'db',
     label_data  JSON         DEFAULT NULL,
     searched_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     PRIMARY KEY (user_id, food_name, source),
     INDEX idx_recent_user_time (user_id, searched_at)
   ) DEFAULT CHARSET = utf8mb4`,
];

// 테이블 만들기는 한 번만. 실패하면 다음 요청 때 다시 시도
let ensured = null;
function ensureMyFoodTables() {
  if (!ensured) {
    ensured = (async () => {
      const db = await getConnection();
      try {
        for (const sql of CREATE_TABLES) await db.execute(sql);
        // [추가] 예전에 만든 테이블에는 source / label_data 가 없다 → 추가하고 키에 source 를 넣는다
        for (const table of ["user_favorites", "user_recent_searches"]) {
          const [cols] = await db.execute(
            "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'source'",
            [table],
          );
          if (Number(cols[0].n) === 0) {
            await db.execute(
              `ALTER TABLE ${table}
                 ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'db',
                 ADD COLUMN label_data JSON DEFAULT NULL,
                 DROP PRIMARY KEY,
                 ADD PRIMARY KEY (user_id, food_name, source)`,
            );
            console.log(`[내 식품] ${table}: source/label_data 컬럼 추가`);
          }
        }
      } finally {
        await db.end();
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

/**
 * 최근 검색 남기기 (같은 이름·같은 출처면 시각만 새로). 실패해도 분석 응답에는 영향 없게 호출하는 쪽에서 catch
 * source: "db" (식품명 검색) | "label" (사진으로 읽은 라벨 → labelData 에 다시 분석할 값을 저장)
 */
async function recordRecentSearch(userId, name, category, source = "db", labelData = null) {
  await ensureMyFoodTables();
  const db = await getConnection();
  try {
    await db.execute(
      `INSERT INTO user_recent_searches (user_id, food_name, category, source, label_data, searched_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE category = VALUES(category), label_data = VALUES(label_data),
                               searched_at = CURRENT_TIMESTAMP(3)`,
      [userId, name, category ?? null, source, labelData ? JSON.stringify(labelData) : null],
    );
  } finally {
    await db.end();
  }
}

// label_data 는 mysql2 가 객체로 주기도, 문자열로 주기도 한다
const parseJson = (v) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);

const toItem = (row, timeKey) => ({
  name: row.food_name,
  category: row.category,
  source: row.source || "db", // [추가] "db" | "label"
  labelData: parseJson(row.label_data), // [추가] 사진 결과를 다시 분석할 값 (식품명 검색이면 null)
  at: row[timeKey] instanceof Date ? row[timeKey].toISOString() : row[timeKey],
});

// ── GET /me/foods ─────────────────────────────────────────────
router.get("/foods", async (req, res) => {
  try {
    await ensureMyFoodTables();
    const db = await getConnection();
    try {
      const [favorites] = await db.execute(
        "SELECT food_name, category, source, label_data, created_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC",
        [req.user.id],
      );
      const [recent] = await db.execute(
        `SELECT food_name, category, source, label_data, searched_at FROM user_recent_searches
         WHERE user_id = ? ORDER BY searched_at DESC LIMIT ${RECENT_LIMIT}`,
        [req.user.id],
      );
      res.json({
        favorites: favorites.map((r) => toItem(r, "created_at")),
        recent: recent.map((r) => toItem(r, "searched_at")),
      });
    } finally {
      await db.end();
    }
  } catch (err) {
    console.error("GET /me/foods 오류:", err);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

// ── POST /me/favorites ────────────────────────────────────────
router.post("/favorites", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ message: "name 이 필요합니다." });
  try {
    await ensureMyFoodTables();
    const db = await getConnection();
    try {
      await db.execute(
        "INSERT IGNORE INTO user_favorites (user_id, food_name, category, source, label_data) VALUES (?, ?, ?, ?, ?)",
        [
          req.user.id,
          name,
          req.body.category ?? null,
          req.body.source === "label" ? "label" : "db",
          req.body.source === "label" && req.body.labelData ? JSON.stringify(req.body.labelData) : null,
        ],
      );
    } finally {
      await db.end();
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("POST /me/favorites 오류:", err);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

// ── DELETE /me/favorites/:name ────────────────────────────────
router.delete("/favorites/:name", async (req, res) => {
  try {
    await ensureMyFoodTables();
    const db = await getConnection();
    try {
      // ?source=label 이면 사진 결과, 아니면 식품명 검색 결과
      await db.execute("DELETE FROM user_favorites WHERE user_id = ? AND food_name = ? AND source = ?", [
        req.user.id,
        req.params.name,
        req.query.source === "label" ? "label" : "db",
      ]);
    } finally {
      await db.end();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /me/favorites 오류:", err);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

// ── DELETE /me/recent ─────────────────────────────────────────
router.delete("/recent", async (req, res) => {
  try {
    await ensureMyFoodTables();
    const db = await getConnection();
    try {
      await db.execute("DELETE FROM user_recent_searches WHERE user_id = ?", [req.user.id]);
    } finally {
      await db.end();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /me/recent 오류:", err);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

module.exports = { router, ensureMyFoodTables, recordRecentSearch };
