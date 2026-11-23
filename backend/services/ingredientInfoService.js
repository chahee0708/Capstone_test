/**
 * ingredientInfoService.js
 *
 * 역할: 원재료 설명표(backend/data/ingredient_info.csv)를 읽어 원재료 이름 → 설명을 찾아 준다
 *
 * 쓰이는 곳: backend/routes/recommend.js (분석 응답의 ingredients 에 설명을 붙인다)
 *
 * CSV 열: name, count, category, description, source, reviewed, examples
 *   - 설명(description)이 빈 줄은 없는 것으로 본다 → 화면에서 이름만 보인다
 *   - [추가] 누구나 아는 재료(OBVIOUS_NAMES: 돼지고기·밀가루·양배추·대파 등)는 설명을 보내지 않는다
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

// [추가] 설명이 없어도 다 아는 재료 → 설명표에 있어도 설명을 빼고 이름만 보인다
//   빼고 싶은 재료가 더 있으면 여기에 이름(설명표 name 열과 같은 글자)을 추가한다
const OBVIOUS_NAMES = new Set([
  // 고기·해산물·달걀
  "돼지고기", "닭가슴살", "새우", "계란",
  // 곡류·가루
  "밀가루", "쌀", "쌀가루", "찹쌀가루", "옥수수", "옥수수가루", "메밀가루", "감자전분",
  // 채소·향신채·버섯·과일
  "양배추", "배추", "당근", "숙주", "마늘", "양파", "부추", "대파", "생강", "청양고추",
  "새송이버섯", "딸기",
  // 콩·견과·해조
  "두부", "참깨", "볶음땅콩", "구운김", "건미역",
  // 유제품
  "우유", "버터", "치즈", "크림치즈",
  // 기본 양념·기름·물
  "설탕", "백설탕", "하얀설탕", "소금", "천일염", "정제수", "참기름", "올리브유", "콩기름",
  "고춧가루", "후춧가루", "후추가루", "간장", "고추장", "된장", "김치", "당면",
]);

// 이름 → { category, description, source } (설명이 있는 줄만)
const infoByName = new Map();
try {
  const text = fs.readFileSync(CSV_PATH, "utf8").replace(/^﻿/, "");
  const [header, ...rows] = parseCsv(text);
  const col = (name) => header.indexOf(name);
  for (const r of rows) {
    const name = (r[col("name")] || "").trim();
    const description = (r[col("description")] || "").trim();
    if (!name || !description || OBVIOUS_NAMES.has(name)) continue;
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

/**
 * [추가] 이름 하나로 설명 찾기. 라벨 표기 그대로는 없는 경우가 많아 조금씩 다듬어 본다
 *   "밀가루1" → "밀가루" (같은 원재료가 여러 번이면 번호를 붙인다), "설탕 10%" → "설탕"
 *   찾으면 { name: 설명표의 이름, category, description, source }
 */
function lookup(raw) {
  const text = raw.trim();
  if (!text) return null;
  const tries = [
    text,
    text.replace(/\s*\d+(?:\.\d+)?\s*%$/, ""), // 함량 "10%"
    text.replace(/\s*\d+$/, ""), // 번호 "밀가루1"
    text.replace(/\s+/g, ""), // 띄어쓰기 "D- 소비톨액"
  ];
  for (const t of tries) {
    const info = t && infoByName.get(t);
    if (info) return { name: t, ...info };
  }
  return null;
}

// 괄호·쉼표·콜론·빗금: 복합원재료의 하위 원재료와 원산지를 나누는 글자
const SEPARATORS = /([[\](){}<>,，、:：/])/;

/**
 * [추가] 복합원재료를 조각으로 나눠 조각마다 설명을 찾는다 (원래 글자는 그대로 이어 붙이면 같다)
 *   "식물성크림[팜핵경화유(인도네시아산), 물엿]" →
 *   [{text:"식물성크림", name, description...}, {text:"["}, {text:"팜핵경화유", ...}, {text:"("},
 *    {text:"인도네시아산"}, {text:"), "}, {text:"물엿", ...}, {text:"]"}]
 *   설명이 없는 조각은 { text } 만 (화면에서 그냥 글자)
 */
function toParts(name) {
  const parts = [];
  const pushText = (text) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && !last.description) last.text += text; // 설명 없는 글자끼리는 합친다
    else parts.push({ text });
  };
  for (const piece of name.split(SEPARATORS)) {
    if (!piece) continue;
    const core = piece.trim();
    const found = SEPARATORS.test(piece) ? null : lookup(core);
    // 괄호 안의 원산지("인도네시아산")는 설명표에 "표기 변형"으로 있지만, 조각에서는 그냥 글자로 둔다
    const info = found && found.category !== "표기 변형" ? found : null;
    if (!info) {
      pushText(piece);
      continue;
    }
    const lead = piece.slice(0, piece.indexOf(core));
    pushText(lead);
    parts.push({ text: core, name: info.name, category: info.category, description: info.description });
    pushText(piece.slice(lead.length + core.length));
  }
  return parts;
}

/**
 * 원재료 이름 배열 → [{ name, category, description, source, parts? }] (설명이 없으면 null)
 *   [추가] 이름 전체로 못 찾으면 괄호 안까지 나눠서 찾은 조각을 parts 로 준다
 *          (조각 중 하나라도 설명이 있을 때만. 화면은 parts 가 있으면 조각마다 말풍선)
 */
function withInfo(names) {
  return names.map((name) => {
    const info = lookup(name);
    const item = {
      name,
      category: info?.category ?? null,
      description: info?.description ?? null,
      source: info?.source ?? null,
    };
    if (!info) {
      const parts = toParts(name);
      if (parts.some((p) => p.description)) item.parts = parts;
    }
    return item;
  });
}

module.exports = { withInfo };
