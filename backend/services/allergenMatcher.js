/**
 * allergenMatcher.js
 *
 * 식품 원재료명/표시 문구에서 알레르기 성분을 찾아 사용자의 알레르기 항목과 연결한다.
 *
 *   parseIngredients(text)        원재료명 → 항목 목록 (괄호 중첩/원산지 표기 처리)
 *   parseAllergenStatement(text)  "○○ 함유", "같은 제조시설에서 제조" 같은 표시 문구 해석
 *   detectAllergens(text)         원재료명에서 확인되는 모든 알레르기 항목
 *   matchUserAllergens(opts)      사용자 알레르기 항목별 결과(근거 포함)
 *
 * 지식 사전은 allergenKnowledge.js 에 있다.
 */

const {
  ALLERGENS,
  GROUPS,
  OFFICIAL_ALLERGENS,
  normalizeText,
  canonicalizeAllergen,
  expandAllergen,
  termsFor,
} = require("./allergenKnowledge");

// 강도 순서 (큰 값이 더 강함)
const LEVEL_RANK = { cross: 1, possible: 2, derived: 3, ingredient: 4, declared: 5 };
const LEVEL_LABEL = {
  declared: "라벨에 함유 표시",
  ingredient: "원재료에 포함",
  derived: "유래 원료",
  possible: "함유 가능성",
  cross: "혼입 가능(제조시설)",
};
// "확실히 들어 있음"과 "가능성"을 구분해 UI 에서 다르게 보여 준다.
const SEVERITY_BY_LEVEL = {
  declared: "contains",
  ingredient: "contains",
  derived: "contains",
  possible: "may_contain",
  cross: "may_contain",
};

// ─────────────────────────────────────────────────────────────
// 1. 원재료명 파싱
// ─────────────────────────────────────────────────────────────
const OPEN = "([{（［";
const CLOSE = ")]}）］";
const ORIGIN_RE = /^(?:국내산|국산|외국산|수입산|[가-힣]{1,6}산|원산지.*|국내제조|수입|등)$/;

/** 최상위 구분자 기준으로 분리 (괄호 안은 유지) */
function splitTopLevel(str, sepRe = /[,，、·ㆍ/;]/) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of str) {
    if (OPEN.includes(ch)) depth += 1;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && sepRe.test(ch)) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * 원재료명 문자열을 평탄한 항목 목록으로 변환한다.
 *   "밀가루(밀:미국산,호주산), 쇼트닝(팜유)" →
 *   [{name:"밀가루"}, {name:"밀"}, {name:"쇼트닝"}, {name:"팜유"}]
 * 괄호 안쪽 항목과 "키:값" 형식의 키도 개별 항목으로 포함한다.
 * @returns {Array<{ name: string, raw: string, depth: number, parent: string|null }>}
 */
function parseIngredients(text) {
  const segments = [];

  const walk = (str, depth, parent) => {
    for (const chunk of splitTopLevel(str)) {
      // 선행 기호/번호 제거: "* 설탕", "1. 밀가루"
      let piece = chunk.replace(/^[*•·\-\s]+/, "").replace(/^\d+[.)]\s*/, "");
      if (!piece) continue;

      // 첫 괄호 앞 = 이름, 그 뒤 괄호들 = 하위 항목
      const m = piece.match(/^([^()[\]{}（）［］]*)([\s\S]*)$/);
      let head = (m ? m[1] : piece).trim();
      const rest = m ? m[2] : "";

      // "키:값" — 예: "밀:미국산", "분말스프:밀가루"
      const kv = head.split(/[:：]/);
      const names = [];
      if (kv.length > 1) {
        for (const part of kv) {
          const p = part.trim();
          if (p && !ORIGIN_RE.test(p)) names.push(p);
        }
      } else if (head) {
        names.push(head);
      }

      for (const nm of names) {
        const clean = nm.replace(/\d+(?:\.\d+)?\s*%/g, "").trim();
        if (clean && !ORIGIN_RE.test(clean)) {
          segments.push({ name: clean, raw: piece, depth, parent });
        }
      }

      // 괄호 안쪽 재귀
      const inner = rest.match(/[([{（［]([\s\S]*)[)\]}）］]\s*$/);
      if (inner) {
        // 같은 항목 뒤에 괄호가 연속될 수 있음: "a(b)[c]" → 전체 안쪽을 한 번에 처리
        walk(inner[1].replace(/[)\]}）］]\s*[([{（［]/g, ","), depth + 1, head || parent);
      } else if (rest.trim()) {
        // 닫는 괄호가 없는 OCR 잡음: 안쪽 텍스트만이라도 검사
        walk(rest.replace(/[()[\]{}（）［］]/g, ","), depth + 1, head || parent);
      }
    }
  };

  walk(String(text || ""), 0, null);
  return segments;
}

// ─────────────────────────────────────────────────────────────
// 2. 표시 문구("함유", "혼입 가능") 해석
// ─────────────────────────────────────────────────────────────

// 표시 문구에서 "알레르기 항목 이름"으로 인정하는 표기 (원재료명 성분은 제외)
const STATEMENT_NAME_INDEX = (() => {
  const set = new Map();
  const put = (n, canonical) => {
    const k = normalizeText(n);
    if (k) set.set(k, canonical);
  };
  for (const [name, def] of Object.entries({ ...ALLERGENS, ...GROUPS })) {
    put(name, name);
    for (const a of def.aliases || []) {
      // "밀가루"처럼 원재료 이름은 표시 문구 항목으로 보지 않는다
      if (a === "밀가루") continue;
      put(a, name);
    }
  }
  for (const [alias, canonical] of [
    ["소고기", "쇠고기"], ["알류", "계란"], ["난류", "계란"], ["달걀", "계란"], ["달갈", "계란"],
    ["이산화황", "아황산류"], ["굴", "조개류"], ["전복", "조개류"], ["홍합", "조개류"], ["바지락", "조개류"],
    ["돼지고기", "돼지고기"], ["닭고기", "닭고기"],
  ]) {
    put(alias, canonical);
  }
  return set;
})();

function statementCanonical(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  const direct = STATEMENT_NAME_INDEX.get(normalizeText(t));
  if (direct) return direct;
  // 괄호 앞부분: "조개류(굴·홍합 포함)", "알류(가금류)", "알류(계란)"
  const head = t.split(/[(（\[]/)[0];
  const hh = STATEMENT_NAME_INDEX.get(normalizeText(head));
  if (hh) return hh;
  return null;
}

// 항목 이름 사이/뒤에 오는 조사·접속 표현 (역방향 스캔에서 건너뜀)
// 주의: 단독 "함유"와 마침표는 일부러 제외한다 — 그 앞에서 스캔이 멈춰야
//       "우유 함유. 밀을 사용한 제품과 같은 제조시설" 처럼 서로 다른 문장의 목록이 섞이지 않는다.
const CONNECTOR_TAIL = /(?:\s|[,，、·ㆍ/・•\-:：;…]|을|를|이|가|은|는|도|등|및|또는|과|와|사용한|사용|제품과|제품|함유한|함유하는|포함|표시|있습니다|있음|\d+)+$/;

/** 텍스트 끝에서부터 연속된 알레르기 항목 이름을 수집한다. */
function backwardAllergenTokens(before) {
  const found = [];
  let s = before;
  for (let guard = 0; guard < 24; guard++) {
    s = s.replace(CONNECTOR_TAIL, "");
    if (!s) break;
    // 마지막 토큰: 괄호 포함 "조개류(굴·홍합 포함)" 도 한 덩어리로
    let tok = null;
    const paren = s.match(/([가-힣A-Za-z]+\s*[(（\[][^)）\]]*[)）\]])$/);
    if (paren) tok = paren[1];
    else {
      const w = s.match(/([가-힣A-Za-z]+)$/);
      if (w) tok = w[1];
    }
    if (!tok) break;
    const canonical = statementCanonical(tok);
    if (!canonical) {
      // "알류" 앞의 "돼지 고기"처럼 띄어 쓴 경우: 공백 제거 후 재시도
      break;
    }
    found.push(canonical);
    s = s.slice(0, s.length - tok.length);
  }
  return found;
}

/** 알레르기 항목 이름 뒤에 나오는 항목들을 앞에서부터 수집 ("알레르기 유발물질 : 우유, 대두") */
function forwardAllergenTokens(after) {
  const found = [];
  const parts = after.split(/[,，、·ㆍ/\s]+/).filter(Boolean);
  for (const p of parts) {
    const c = statementCanonical(p.replace(/[.。]+$/, ""));
    if (!c) break;
    found.push(c);
  }
  return found;
}

const CROSS_KEYWORDS = [
  /(?:같은|동일한|동일|같은\s*공장의)\s*(?:제조\s*)?(?:시설|설비|라인|공장|작업장)/g,
  /혼입\s*(?:될|가능|우려)/g,
  /교차\s*오염/g,
  /사용한\s*제품과/g,
];

/**
 * 제품 라벨의 알레르기 표시 문구를 해석한다.
 *   "밀,땅콩,대두,우유 함유"                                  → declared: [밀,땅콩,대두,우유]
 *   "메밀을 사용한 제품과 같은 제조시설에서 제조"                 → cross: [메밀]
 *   "알레르기 유발물질 : 우유, 대두"                          → declared: [우유,대두]
 *
 * @param {string} text OCR 결과 또는 원재료명 전체 텍스트
 * @returns {{ declared: string[], cross: string[], remaining: string }}
 *   remaining: 표시 문구 부분을 제거한 텍스트 (원재료 검사용)
 */
function parseAllergenStatement(text) {
  const src = String(text || "").replace(/\r/g, "");
  const declared = new Set();
  const cross = new Set();
  const cut = []; // [start, end) 제거 구간

  // (a) 혼입/제조시설 문구 — 먼저 처리해서 declared 와 섞이지 않게 한다
  for (const re of CROSS_KEYWORDS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const before = src.slice(Math.max(0, m.index - 160), m.index);
      const toks = backwardAllergenTokens(before);
      toks.forEach((t) => cross.add(t));
      if (toks.length > 0) {
        // 목록 시작 위치를 추정해 제거 구간에 포함
        let start = m.index;
        let s = before;
        for (let i = 0; i < toks.length; i++) {
          s = s.replace(CONNECTOR_TAIL, "");
          const paren = s.match(/([가-힣A-Za-z]+\s*[(（\[][^)）\]]*[)）\]])$/);
          const w = paren || s.match(/([가-힣A-Za-z]+)$/);
          if (!w) break;
          s = s.slice(0, s.length - w[1].length);
        }
        start = Math.max(0, m.index - 160) + s.length;
        // 문장 끝까지 (마침표/줄바꿈/80자)
        const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 80);
        const endRel = tail.search(/[.。\n]/);
        const end = m.index + m[0].length + (endRel >= 0 ? endRel + 1 : Math.min(tail.length, 40));
        cut.push([start, end]);
      }
    }
  }

  // (b) "~ 함유" 문구
  const inCut = (idx) => cut.some(([a, b]) => idx >= a && idx < b);
  const reContain = /함유/g;
  let m;
  while ((m = reContain.exec(src)) !== null) {
    if (inCut(m.index)) continue;
    const before = src.slice(Math.max(0, m.index - 160), m.index);
    // "함유량", "비타민 함유" 같은 일반 문장은 목록 토큰이 없으므로 자연히 무시된다
    const toks = backwardAllergenTokens(before);
    if (toks.length === 0) continue;
    toks.forEach((t) => declared.add(t));
    let s = before;
    for (let i = 0; i < toks.length; i++) {
      s = s.replace(CONNECTOR_TAIL, "");
      const paren = s.match(/([가-힣A-Za-z]+\s*[(（\[][^)）\]]*[)）\]])$/);
      const w = paren || s.match(/([가-힣A-Za-z]+)$/);
      if (!w) break;
      s = s.slice(0, s.length - w[1].length);
    }
    cut.push([Math.max(0, m.index - 160) + s.length, m.index + m[0].length]);
  }

  // (c) "알레르기 유발물질 : 우유, 대두" (함유 없이 나열)
  const reLabel = /알레르기\s*(?:유발)?\s*(?:물질|성분|정보|표시)?\s*[:：]?/g;
  while ((m = reLabel.exec(src)) !== null) {
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 120);
    const toks = forwardAllergenTokens(after);
    toks.forEach((t) => declared.add(t));
    if (toks.length > 0) cut.push([m.index, m.index + m[0].length + after.length]);
  }

  // 제거 구간 병합 후 remaining 생성
  cut.sort((a, b) => a[0] - b[0]);
  let remaining = "";
  let pos = 0;
  for (const [a, b] of cut) {
    if (a > pos) remaining += src.slice(pos, a);
    pos = Math.max(pos, b);
  }
  remaining += src.slice(pos);

  return {
    declared: Array.from(declared),
    cross: Array.from(cross).filter((c) => !declared.has(c)),
    remaining,
  };
}

// ─────────────────────────────────────────────────────────────
// 3. 키워드 매칭
// ─────────────────────────────────────────────────────────────

function removeExclusions(text, excludes) {
  let out = text;
  for (const ex of excludes) {
    if (ex.startsWith("=")) continue;
    if (out.includes(ex)) out = out.split(ex).join("");
  }
  return out;
}

// "향/맛/풍미/시즈닝"이 붙은 원료(예: 크림향, 치킨향분말, 베이컨시즈닝)는 실제 원료가 아니라
// 향미 제제인 경우가 많아 확정(derived/ingredient) 대신 "가능성"으로 낮춘다.
const FLAVOR_MARKERS = ["향", "맛", "풍미", "플레이버", "시즈닝", "flavor", "flavour"];

function followedByFlavor(text, endIdx) {
  const tail = text.slice(endIdx, endIdx + 12);
  return FLAVOR_MARKERS.some((m) => tail.startsWith(m));
}

/**
 * possible 키워드가 ingredient/derived 키워드를 포함하는 경우(예: 식물성크림 ⊃ 크림)에는
 * 더 구체적인 possible 쪽을 우선한다. 그렇지 않으면 "크림" 때문에 확정으로 올라간다.
 */
function isOverridePossible(term, terms) {
  if (term.startsWith("=")) return false;
  return [...terms.ingredient, ...terms.derived].some(
    (t) => !t.startsWith("=") && t !== term && term.includes(t)
  );
}

/**
 * 정규화된 항목 하나를 한 알레르기의 사전과 비교해 가장 강한 일치를 반환한다.
 * @returns {{ level: string, term: string } | null}
 */
function matchSegment(normName, terms) {
  let text = removeExclusions(normName, terms.exclude);
  let best = null;
  const consider = (level, term) => {
    const cand = { level, term };
    if (
      !best ||
      LEVEL_RANK[level] > LEVEL_RANK[best.level] ||
      (level === best.level && term.length > best.term.length)
    ) {
      best = cand;
    }
  };

  // 1) 구체적인 "가능성" 표현 먼저 (식물성크림 등) — 일치 구간은 이후 확정 검사에서 제외
  for (const t of terms.possible) {
    if (!isOverridePossible(t, terms)) continue;
    if (text.includes(t)) {
      consider("possible", t);
      text = text.split(t).join("");
    }
  }

  // 2) 일반 검사
  for (const level of ["ingredient", "derived", "possible"]) {
    for (const t of terms[level]) {
      if (t.startsWith("=")) {
        if (normName === t.slice(1)) consider(level, t.slice(1));
        continue;
      }
      if (isOverridePossible(t, terms)) continue;
      const idx = text.indexOf(t);
      if (idx < 0) continue;
      const flavored =
        followedByFlavor(text, idx + t.length) ||
        FLAVOR_MARKERS.some((m) => t.endsWith(m));
      consider(flavored && LEVEL_RANK[level] > LEVEL_RANK.possible ? "possible" : level, t);
    }
  }
  return best;
}

// 세부 성분이 표기되지 않은 복합 원료 — 알레르기 성분이 가려져 있을 수 있다.
const OPAQUE_RE = /(복합조미식품|혼합제제|기타가공품|[가-힣]{1,6}가공품|스프류|분말스프|액상스프|파우더믹스|맛베이스|감칠맛|풍미유|풍미분|조미분|양념분말|베이스분말|혼합양념|혼합조미|^소스$|소스류|^양념$|즉석조리식품|즉석섭취식품|음료베이스|향신료조제품|조림류)/;

/**
 * 원재료명에 세부 성분이 드러나지 않는 원료가 있는지 확인한다.
 * @returns {string[]} 해당 원료 이름(중복 제거, 최대 6개)
 */
function findOpaqueIngredients(ingredientsText) {
  const names = [];
  for (const seg of parseIngredients(parseAllergenStatement(ingredientsText).remaining)) {
    if (seg.depth > 0) continue; // 최상위 원료만 (하위가 나열되어 있으면 이미 드러난 것)
    if (OPAQUE_RE.test(seg.name) && !names.includes(seg.name)) names.push(seg.name);
  }
  return names.slice(0, 6);
}

// 원재료명 쉼표가 OCR 로 사라진 경우를 대비해 전체 텍스트도 한 항목으로 검사한다.
function buildSegments(ingredientsText) {
  const segs = parseIngredients(ingredientsText);
  const full = normalizeText(ingredientsText);
  const avgLen = segs.length ? segs.reduce((n, s) => n + s.name.length, 0) / segs.length : 0;
  if (full && (segs.length <= 1 || avgLen > 24)) {
    segs.push({ name: String(ingredientsText), raw: String(ingredientsText), depth: 0, parent: null, whole: true });
  }
  return segs;
}

/**
 * 하나의 표준 항목(또는 묶음)에 대해 원재료명을 검사한다.
 * @returns {{ level: string, evidence: Array } | null}
 */
function scanForAllergen(segments, canonical) {
  const terms = termsFor(canonical);
  const evidence = [];
  let best = null;
  const seen = new Set();
  for (const seg of segments) {
    const norm = normalizeText(seg.name);
    if (!norm) continue;
    const hit = matchSegment(norm, terms);
    if (!hit) continue;
    const key = `${seg.name}|${hit.term}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({
      ingredient: seg.name.length > 40 ? `${seg.name.slice(0, 40)}…` : seg.name,
      keyword: hit.term,
      level: hit.level,
      parent: seg.parent || undefined,
    });
    if (!best || LEVEL_RANK[hit.level] > LEVEL_RANK[best]) best = hit.level;
  }
  if (!best) return null;
  evidence.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  return { level: best, evidence: evidence.slice(0, 6) };
}

/**
 * 원재료명에서 확인되는 알레르기 항목 전체 (표준 19종 + 묶음 구성원)
 * @param {string} ingredientsText
 * @returns {Record<string, { level: string, evidence: Array }>}
 */
function detectAllergens(ingredientsText) {
  const { remaining } = parseAllergenStatement(ingredientsText);
  const segments = buildSegments(remaining);
  const out = {};
  const names = Array.from(new Set([...OFFICIAL_ALLERGENS, ...Object.keys(ALLERGENS)]));
  for (const name of names) {
    const r = scanForAllergen(segments, name);
    if (r) out[name] = r;
  }
  return out;
}

/**
 * 사용자 알레르기 항목별로 검출 결과를 만든다.
 *
 * @param {object} opts
 * @param {string}   [opts.ingredientsText] 원재료명(표시 문구가 섞여 있어도 됨)
 * @param {string[]} [opts.declared]        라벨 "함유" 표시 항목(OCR 등으로 이미 추출한 값)
 * @param {string[]} [opts.cross]           혼입 가능 표시 항목
 * @param {string[]} opts.userAllergens     사용자가 등록한 알레르기
 * @returns {Array<{
 *   allergen: string, canonical: string, level: string, severity: "contains"|"may_contain",
 *   label: string, evidence: Array
 * }>}  검출된 항목만 반환
 */
function matchUserAllergens({ ingredientsText = "", declared = [], cross = [], userAllergens = [] }) {
  const stmt = parseAllergenStatement(ingredientsText);
  const declaredSet = new Set([...declared.map(canonicalizeAllergen), ...stmt.declared]);
  const crossSet = new Set([...cross.map(canonicalizeAllergen), ...stmt.cross]);
  const segments = buildSegments(stmt.remaining);

  const results = [];
  const seenUser = new Set();
  for (const userItem of userAllergens) {
    const user = String(userItem || "").trim();
    if (!user || seenUser.has(user)) continue;
    seenUser.add(user);

    const canonical = canonicalizeAllergen(user);
    const covered = expandAllergen(user); // 자기 자신 + 묶음 구성원
    let level = null;
    const evidence = [];

    const bump = (lv) => {
      if (!level || LEVEL_RANK[lv] > LEVEL_RANK[level]) level = lv;
    };

    for (const c of covered) {
      if (declaredSet.has(c)) {
        bump("declared");
        evidence.push({ ingredient: `라벨 표시: ${c} 함유`, keyword: c, level: "declared" });
      }
      if (crossSet.has(c)) {
        bump("cross");
        evidence.push({ ingredient: `라벨 표시: ${c} 혼입 가능`, keyword: c, level: "cross" });
      }
    }

    const scan = scanForAllergen(segments, canonical);
    if (scan) {
      bump(scan.level);
      evidence.push(...scan.evidence);
    }

    if (level) {
      results.push({
        allergen: user,
        canonical,
        level,
        severity: SEVERITY_BY_LEVEL[level],
        label: LEVEL_LABEL[level],
        evidence: evidence.slice(0, 8),
      });
    }
  }
  // 강한 항목이 먼저
  results.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  return results;
}

module.exports = {
  LEVEL_RANK,
  LEVEL_LABEL,
  SEVERITY_BY_LEVEL,
  parseIngredients,
  parseAllergenStatement,
  detectAllergens,
  matchUserAllergens,
  scanForAllergen,
  findOpaqueIngredients,
};
