const mysql = require("mysql2/promise");

// 요청마다 커넥션을 새로 만들지 않고 풀을 공유한다.
// (이전 구현은 오류 경로에서 conn.end()가 호출되지 않아 커넥션이 누수될 수 있었다.)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
});

/**
 * 단일 쿼리 실행. 커넥션 획득/반환은 풀이 처리한다.
 * @returns {Promise<[rows, fields]>}
 */
function execute(sql, params = []) {
  return pool.execute(sql, params);
}

module.exports = { pool, execute };
