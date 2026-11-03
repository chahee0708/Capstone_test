/**
 * evalAlternatives.js
 *
 * 목적: 대체음식 유사도 기준값 0.70 vs 0.75 를 "가상 사용자 평가" 로 비교한다.
 *       가상 사용자 5명 × 대체음식 대상 음식(category_mid 있음 + alt_candidate = true) 전부에 대해
 *       원래 음식 판정 → 주의/비추천이면 대체음식을 0.70 / 0.75 기준으로 각각 구해
 *       "대체음식을 1개 이상 / 3개 제공한 비율" 을 비교하고, 결정 규칙으로 기준값을 고른다.
 *
 * 실행 (ML 서버 연결이 필요하므로 백엔드 컨테이너 안에서):
 *   docker compose exec backend node scripts/evalAlternatives.js
 *   결과 파일은 컨테이너 안 /app/eval_output/ 에 생기므로 호스트로 꺼낼 때:
 *   docker compose cp backend:/app/eval_output ./backend/eval_output
 *
 * 출력:
 *   1) eval_output/alt_eval_detail.csv  : 사용자, 음식명, 중분류, 원래 판정, 기준값, 대체음식 수, 대체음식 이름들
 *                                         (주의/비추천 음식만, 기준값마다 1행)
 *   2) eval_output/alt_eval_summary.csv + 콘솔 표 : 사용자별 제공률 (1개 이상 / 3개) + 평균
 *   3) 콘솔: 중분류별 0.70 / 0.75 제공률
 *   4) 콘솔: 결정 규칙 결과 — 0.75 평균 제공률이 0.70 보다 10%p 이상 낮지 않으면 0.75, 낮으면 0.70
 *
 * 규칙 (alternativeService.js 와 완전히 같게, 스크립트 안에서만 다시 구현 — 서비스 코드는 건드리지 않음):
 *   - 후보: 같은 category_mid, alt_candidate = true, 원래 음식과 이름·report_no 다름, 원재료 1개 이상
 *           (가상 사용자는 알레르기가 없으므로 알레르기 제외 조건은 해당 없음)
 *   - 유사도 기준 이상만 → 유사도 높은 순 → 유사도(소수 둘째 자리)가 같은 묶음은 등급 좋은 순,
 *     등급도 같으면 이름 가나다순 → report_no 순 ([변경] 서비스의 동점 정렬 변경에 맞춤)
 *   - 서비스의 "알레르기 정보 없는 후보 제외" 는 사용자 알레르기가 있을 때만 적용 → 가상 사용자는 해당 없음
 *   - 등급 필터: 후보 등급이 원래 판정보다 더 나은 것
 *   - 최대 3개
 *
 * 성능:
 *   - 같은 (사용자, 음식) 판정은 캐시 → 원래 음식으로도, 후보로도 한 번만 판정 (2형 당뇨 ML 호출 절약)
 *   - 음식별 0.70 이상 후보 목록(유사도)은 사용자와 무관하므로 한 번만 계산
 *   - 0.75 결과는 0.70 후보의 부분집합에서, 저장된 판정으로 계산
 *
 * 이번에 바뀐 점: 서비스에서 allergyOverride 분기가 삭제되어 등급 필터 주석만 수정 (동작 변경 없음)
 * 이전 변경: [변경] 동점 정렬을 서비스와 같게 (이름 가나다순 → report_no 순)
 *
 * 호출: 개발자가 직접 실행 (서비스에서 호출하지 않음)
 */

const fs = require("fs");
const path = require("path");
const { getSession } = require("../db/neo4j");
const { similarity } = require("../services/similarity");
const { toNutrition } = require("../services/foodService");
const { judgeDiseaseNutrition, judgeHealthyNutrition } = require("../services/scoreService");
const { MAX_ALTERNATIVES } = require("../config/alternatives");

const THRESHOLDS = [0.7, 0.75];
const BASE_THRESHOLD = Math.min(...THRESHOLDS); // 이 값 이상 후보만 한 번 재판정해 두고 재사용
const OUT_DIR = path.join(__dirname, "..", "eval_output");
const RANK = { 추천: 2, 주의: 1, 비추천: 0 };
const round2 = (n) => Math.round(n * 100) / 100;
// [추가] 문자열 비교 (코드 순) — alternativeService.js 의 compareText 와 동일
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ─────────────────────────────────────────────────────────────
// 가상 사용자 5명 (공통: 45세 남성, 170cm, 70kg, 알레르기 없음)
// users 테이블 행 형식으로 적고, diseaseDetails 는 recommend.js 와 같은 식으로 만든다
// ─────────────────────────────────────────────────────────────
const COMMON = { age: 45, gender: "male", height: 170, weight: 70, allergens: [] };
const VIRTUAL_USERS = [
  { label: "고혈압", ...COMMON, diseases: ["고혈압"], hypertension_stage: 1 },
  { label: "2형 당뇨", ...COMMON, diseases: ["2형 당뇨"] },
  { label: "이상지질혈증", ...COMMON, diseases: ["이상지질혈증"], ldl_value: 160, tg_value: 200, hdl_value: 40 },
  { label: "신장질환", ...COMMON, diseases: ["신장병"], gfr_value: 35 },
  { label: "무질환", ...COMMON, diseases: [] },
];

/** recommend.js 의 diseaseDetails 생성식과 동일 (users 행 → scoreService 형식) */
function toDiseaseDetails(u) {
  return {
    hypertension_stage: u.hypertension_stage || 1,
    ldl_value: u.ldl_value ?? null,
    tg_value: u.tg_value ?? null,
    hdl_value: u.hdl_value ?? null,
    gfr_value: u.gfr_value != null ? u.gfr_value : 35,
  };
}

/** 사용자 기준 판정 — alternativeService.js 의 judge() 와 같은 분기 */
async function judge(nutrition, u) {
  if (u.diseases.length > 0) {
    return judgeDiseaseNutrition(nutrition, u.diseases, u.weight, u.height, u.age, u.gender, toDiseaseDetails(u));
  }
  return judgeHealthyNutrition(nutrition, u.weight, u.height, u.age, u.gender);
}

/** CSV 한 칸: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다 */
const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV 저장 (UTF-8 BOM → 엑셀에서 한글 안 깨짐) */
function writeCsv(file, header, rows) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  fs.writeFileSync(file, "﻿" + lines.join("\n") + "\n", "utf8");
}
const pct = (n, d) => (d === 0 ? 0 : (n / d) * 100);
const fmtPct = (p) => `${p.toFixed(1)}%`;

/**
 * 대체음식 선택 — alternativeService.js 3a~3e 와 같은 순서
 * @param candidates [{ food, sim }] (유사도 높은 순으로 정렬된 BASE_THRESHOLD 이상 후보)
 * @param threshold  이번 기준값
 * @param verdictOf  report_no → 저장된 판정 등급
 * @param origVerdict 원래 음식 판정
 */
function pickAlternatives(candidates, threshold, verdictOf, origVerdict) {
  const ranked = candidates.filter((c) => c.sim >= threshold); // 이미 유사도 높은 순
  const passes = (v) => RANK[v] > RANK[origVerdict]; // 더 나은 등급만 (알레르기 없음)
  const results = [];
  let i = 0;
  while (i < ranked.length && results.length < MAX_ALTERNATIVES) {
    // 유사도(소수 둘째 자리)가 같은 묶음
    const groupSim = round2(ranked[i].sim);
    const group = [];
    while (i < ranked.length && round2(ranked[i].sim) === groupSim) group.push(ranked[i++]);
    // [변경] 묶음 안: 등급 필터 → 등급 좋은 순 → 이름 가나다순 → report_no 순 (서비스와 동일)
    const judged = group
      .map((c) => ({ ...c, verdict: verdictOf.get(c.food.reportNo) }))
      .filter((c) => c.verdict && passes(c.verdict))
      .sort(
        (a, b) =>
          RANK[b.verdict] - RANK[a.verdict] ||
          compareText(a.food.name, b.food.name) ||
          compareText(a.food.reportNo ?? "", b.food.reportNo ?? ""),
      );
    for (const c of judged) {
      if (results.length >= MAX_ALTERNATIVES) break;
      results.push(c);
    }
  }
  return results;
}

async function main() {
  const startedAt = Date.now();
  const session = getSession();
  try {
    // ── 1. 대상 음식 전부 읽기 (원재료 order 순 + 영양소 속성) ──
    const res = await session.run(`
      MATCH (f:Food) WHERE f.alt_candidate = true AND f.category_mid IS NOT NULL
      OPTIONAL MATCH (f)-[r:HAS_INGREDIENT]->(i:Ingredient)
      WITH f, r, i ORDER BY r.order
      WITH f, collect(i.name) AS ingredients
      RETURN f.report_no AS reportNo, f.name AS name, f.category_mid AS categoryMid, ingredients,
             f { .sugar, .sodium, .saturated_fat, .protein, .calories,
                 .carbohydrate, .fat, .trans_fat, .cholesterol } AS props
      ORDER BY f.category_mid, f.name`);
    const foods = res.records.map((r) => ({
      reportNo: r.get("reportNo"),
      name: r.get("name"),
      categoryMid: r.get("categoryMid"),
      ingredients: r.get("ingredients"),
      nutrition: toNutrition(r.get("props")),
    }));
    console.log(`대상 음식: ${foods.length}개, 가상 사용자: ${VIRTUAL_USERS.length}명\n`);

    // ── 2. 음식별 후보 목록 (유사도 BASE_THRESHOLD 이상, 높은 순) — 사용자와 무관하므로 한 번만 ──
    const byCategory = new Map();
    for (const f of foods) {
      if (!byCategory.has(f.categoryMid)) byCategory.set(f.categoryMid, []);
      byCategory.get(f.categoryMid).push(f);
    }
    const candidatesOf = new Map(); // report_no → [{ food, sim }]
    for (const f of foods) {
      if (f.ingredients.length === 0) {
        candidatesOf.set(f.reportNo, []); // 원재료 없는 원래 음식 → 서비스도 [] 반환
        continue;
      }
      const list = byCategory
        .get(f.categoryMid)
        .filter((c) => c.name !== f.name && c.reportNo !== f.reportNo && c.ingredients.length > 0)
        .map((c) => ({ food: c, sim: similarity(f.ingredients, c.ingredients) }))
        .filter((c) => c.sim >= BASE_THRESHOLD)
        .sort((a, b) => b.sim - a.sim);
      candidatesOf.set(f.reportNo, list);
    }

    // ── 3. 사용자 × 음식 평가 ──
    const detailRows = [];
    const summary = []; // 사용자별 집계
    const catStats = new Map(); // 중분류 → { target, provided: {0.7: n, 0.75: n} }

    for (const u of VIRTUAL_USERS) {
      const userStart = Date.now();
      // (사용자, 음식) 판정 캐시: report_no → 등급. 원래 음식·후보 공용 (2형 당뇨 ML 호출 1회씩)
      const verdictOf = new Map();
      const judgeCached = async (food) => {
        if (verdictOf.has(food.reportNo)) return verdictOf.get(food.reportNo);
        let v = null;
        try {
          v = (await judge(food.nutrition, u))?.verdict ?? null;
        } catch (err) {
          // 서비스와 같이: 판정 에러는 건너뛰고 로그만 (후보로도 제외됨)
          console.error(`  [판정 실패] ${u.label} / ${food.name}: ${err.message}`);
        }
        verdictOf.set(food.reportNo, v);
        return v;
      };

      const stat = { label: u.label, target: 0, any: { 0.7: 0, 0.75: 0 }, full: { 0.7: 0, 0.75: 0 } };

      for (const [idx, f] of foods.entries()) {
        // 3-1. 원래 음식 판정 → 주의/비추천만 대체음식 계산
        const orig = await judgeCached(f);
        if (orig === "주의" || orig === "비추천") {
          stat.target++;
          const cs = catStats.get(f.categoryMid) ?? { target: 0, provided: { 0.7: 0, 0.75: 0 } };
          cs.target++;

          // 3-2. 0.70 이상 후보를 한 번씩만 재판정해 저장 (0.75 후보는 이 부분집합)
          const candidates = candidatesOf.get(f.reportNo);
          for (const c of candidates) await judgeCached(c.food);

          // 3-3. 기준값별로 저장된 판정에서 대체음식 선택
          for (const t of THRESHOLDS) {
            const alts = pickAlternatives(candidates, t, verdictOf, orig);
            if (alts.length > 0) {
              stat.any[t]++;
              cs.provided[t]++;
            }
            if (alts.length >= MAX_ALTERNATIVES) stat.full[t]++;
            detailRows.push([
              u.label, f.name, f.categoryMid, orig, t.toFixed(2), alts.length,
              alts.map((a) => a.food.name).join(" | "),
            ]);
          }
          catStats.set(f.categoryMid, cs);
        }

        // 3-4. 100개마다 진행 상황
        if ((idx + 1) % 100 === 0 || idx + 1 === foods.length) {
          console.log(`  [${u.label}] ${idx + 1}/${foods.length} (주의·비추천 ${stat.target}개, ${((Date.now() - userStart) / 1000).toFixed(1)}s)`);
        }
      }
      summary.push(stat);
    }

    // ── 4. 파일 저장 ──
    fs.mkdirSync(OUT_DIR, { recursive: true });
    writeCsv(
      path.join(OUT_DIR, "alt_eval_detail.csv"),
      ["사용자", "음식명", "중분류", "원래 판정", "기준값", "대체음식 수", "대체음식 이름들"],
      detailRows,
    );

    const summaryRows = summary.map((s) => [
      s.label,
      s.target,
      pct(s.any[0.7], s.target),
      pct(s.any[0.75], s.target),
      pct(s.full[0.7], s.target),
      pct(s.full[0.75], s.target),
    ]);
    // 평균: 사용자별 비율의 평균 (주의·비추천 음식 수는 평균 개수)
    const avg = (k) => summaryRows.reduce((a, r) => a + r[k], 0) / summaryRows.length;
    const avgRow = ["평균", avg(1), avg(2), avg(3), avg(4), avg(5)];
    writeCsv(
      path.join(OUT_DIR, "alt_eval_summary.csv"),
      ["가상 사용자", "주의·비추천 음식 수", "0.70 제공률(1개+)", "0.75 제공률(1개+)", "0.70 (3개)", "0.75 (3개)"],
      [...summaryRows, avgRow].map((r) => [r[0], r[0] === "평균" ? r[1].toFixed(1) : r[1], ...r.slice(2).map((p) => p.toFixed(1))]),
    );

    // ── 5. 콘솔 표: 사용자별 ──
    console.log("\n[사용자별 대체음식 제공률]");
    console.table(
      [...summaryRows, avgRow].map((r) => ({
        "가상 사용자": r[0],
        "주의·비추천 음식 수": r[0] === "평균" ? Number(r[1].toFixed(1)) : r[1],
        "0.70 제공률(1개+)": fmtPct(r[2]),
        "0.75 제공률(1개+)": fmtPct(r[3]),
        "0.70 (3개)": fmtPct(r[4]),
        "0.75 (3개)": fmtPct(r[5]),
      })),
    );

    // ── 6. 콘솔 표: 중분류별 (전체 사용자 합산, 0.70 제공률 낮은 순) ──
    console.log("[중분류별 제공률 (5명 합산, 주의·비추천 음식 기준)]");
    console.table(
      [...catStats.entries()]
        .map(([cat, s]) => ({
          중분류: cat,
          "주의·비추천": s.target,
          "0.70 제공률": pct(s.provided[0.7], s.target),
          "0.75 제공률": pct(s.provided[0.75], s.target),
        }))
        .sort((a, b) => a["0.70 제공률"] - b["0.70 제공률"])
        .map((r) => ({ ...r, "0.70 제공률": fmtPct(r["0.70 제공률"]), "0.75 제공률": fmtPct(r["0.75 제공률"]) })),
    );

    // ── 7. 결정 규칙 ──
    const diffP = avg(2) - avg(3); // 0.70 평균 - 0.75 평균 (%p)
    const chosen = diffP >= 10 ? 0.7 : 0.75;
    console.log(
      `[결정] 평균 제공률 0.70 = ${fmtPct(avg(2))}, 0.75 = ${fmtPct(avg(3))} (차이 ${diffP.toFixed(1)}%p) → ` +
        `${diffP >= 10 ? "0.75 가 10%p 이상 낮음" : "0.75 가 10%p 이상 낮지 않음"} → 선택값 ${chosen.toFixed(2)}`,
    );
    console.log(`\n저장: ${OUT_DIR}/alt_eval_detail.csv, alt_eval_summary.csv`);
    console.log(`전체 소요 시간: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } finally {
    await session.close();
  }
  process.exit(0); // neo4j 드라이버 연결이 남아 있어도 종료
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
