const mysql = require("mysql2/promise");

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4", // ← 추가
};

async function getConnection() {
  return await mysql.createConnection(dbConfig);
  await conn.execute("SET NAMES utf8mb4"); // ← 추가
  return conn;
}

module.exports = { getConnection };
