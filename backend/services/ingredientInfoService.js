/**
 * ingredientInfoService.js
 *
 * 역할: 원재료 설명표(backend/data/ingredient_info.csv)를 읽어 원재료 이름 → 설명을 찾아 준다
 *
 * 쓰이는 곳: backend/routes/recommend.js (분석 응답의 ingredients 에 설명을 붙인다)
 *
 * CSV 열: name, count, category, description, source, reviewed, examples
 *   - 설명(description)이 빈 줄은 없는 것으로 본다 → 화면에서 이름만 보인다
 *   - 서버가 켜질 때 한 번만 읽는다. CSV 를 고치면 백엔드를 다시 빌드·재시작해야 반영된다
 *
 * 예) withInfo(["설탕", "정제수"]) →
 *     [{ name: "설탕", category: "감미료", description: "사탕수수·...", source: "농촌진흥청 ..." },
 *      { name: "정제수", ... }]
 */
const fs = require("fs");
const path = require("path");

const CSV_PATH = path.join(__dirname, "..", "data", "ingredient_info.csv");

/** 따옴표("...")와 따옴표 안의 쉼표·줄바꿈·"" 를 처리하는 간단한 CSV 파서 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 이름 → { category, description, source } (설명이 있는 줄만)
const infoByName = new Map();
try {
  const text = fs.readFileSync(CSV_PATH, "utf8").replace(/^﻿/, "");
  const [header, ...rows] = parseCsv(text);
  const col = (name) => header.indexOf(name);
  for (const r of rows) {
    const name = (r[col("name")] || "").trim();
    const description = (r[col("description")] || "").trim();
    if (!name || !description) continue;
    infoByName.set(name, {
      category: (r[col("category")] || "").trim() || null,
      description,
      source: (r[col("source")] || "").trim() || null,
    });
  }
  console.log(`[원재료 설명] ${infoByName.size}개 읽음`);
} catch (err) {
  // 설명표가 없어도 분석은 되어야 한다 → 이름만 보낸다
  console.error("[원재료 설명] CSV 읽기 실패:", err.message);
}

/** 원재료 이름 배열 → [{ name, category, description, source }] (설명이 없으면 null) */
function withInfo(names) {
  return names.map((name) => {
    const info = infoByName.get(name.trim());
    return {
      name,
      category: info?.category ?? null,
      description: info?.description ?? null,
      source: info?.source ?? null,
    };
  });
}

module.exports = { withInfo };
