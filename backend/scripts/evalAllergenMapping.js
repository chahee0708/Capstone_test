/**
 * 알레르기 매핑 평가 스크립트
 *
 * 라벨의 "○○ 함유" 표시(정답)와, 원재료명에서 매핑 로직이 찾아낸 항목을 비교한다.
 *   node scripts/evalAllergenMapping.js [fixture.json] [--verbose]
 *
 * 재현율(recall)이 핵심 지표다(놓침 방지). 정밀도는 참고용이다:
 *  - 라벨에 표시가 없어도 원재료에 실제로 들어 있는 경우(표시 누락)나
 *  - '가능성(possible)' 수준 경고가 정밀도를 낮출 수 있다.
 */
const path = require("path");
const fs = require("fs");
const { detectAllergens, parseAllergenStatement } = require("../services/allergenMatcher");
const { canonicalizeAllergen, OFFICIAL_ALLERGENS } = require("../services/allergenKnowledge");

const fixturePath = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : path.join(__dirname, "..", "test", "fixtures", "label_samples.json");
const verbose = process.argv.includes("--verbose");
const samples = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

const CONTAINS = new Set(["ingredient", "derived", "declared"]);
const stats = {};
const init = (a) => (stats[a] ||= { declared: 0, tp: 0, tpPossible: 0, fn: 0, fp: 0, fpPossible: 0, fnItems: [], fpItems: [] });

let n = 0;
for (const s of samples) {
  const declared = new Set((s.allergy || []).map(canonicalizeAllergen).filter((c) => OFFICIAL_ALLERGENS.includes(c)));
  if (declared.size === 0) continue;
  n += 1;
  const found = detectAllergens(s.ingredients);

  for (const a of OFFICIAL_ALLERGENS) {
    const f = found[a];
    const isDeclared = declared.has(a);
    const st = init(a);
    if (isDeclared) {
      st.declared += 1;
      if (f && CONTAINS.has(f.level)) st.tp += 1;
      else if (f) { st.tpPossible += 1; st.fnItems.push(`${s.name}  [possible:${f.evidence[0]?.ingredient}]`); }
      else st.fnItems.push(s.name);
      if (!f) st.fn += 1;
    } else if (f) {
      if (CONTAINS.has(f.level)) { st.fp += 1; st.fpItems.push(`${s.name}  [${f.evidence.map((e) => `${e.ingredient}→${e.keyword}`).slice(0, 3).join(", ")}]`); }
      else st.fpPossible += 1;
    }
  }
}

console.log(`평가 대상: 표시 문구가 있는 제품 ${n}건\n`);
console.log("항목        정답  확정검출  가능성만  미검출  재현율   과잉(확정)  과잉(가능성)");
let totDecl = 0, totTp = 0, totTpP = 0;
for (const a of OFFICIAL_ALLERGENS) {
  const st = stats[a];
  if (!st || st.declared === 0) continue;
  totDecl += st.declared; totTp += st.tp; totTpP += st.tpPossible;
  const recall = ((st.tp + st.tpPossible) / st.declared * 100).toFixed(1);
  console.log(
    `${a.padEnd(8, "　")}${String(st.declared).padStart(5)}${String(st.tp).padStart(9)}${String(st.tpPossible).padStart(9)}${String(st.fn).padStart(8)}${(recall + "%").padStart(9)}${String(st.fp).padStart(10)}${String(st.fpPossible).padStart(12)}`
  );
}
console.log(`\n전체 재현율(확정+가능성): ${(((totTp + totTpP) / totDecl) * 100).toFixed(1)}%   확정만: ${((totTp / totDecl) * 100).toFixed(1)}%`);

if (verbose) {
  for (const a of OFFICIAL_ALLERGENS) {
    const st = stats[a];
    if (!st) continue;
    if (st.fnItems.length) console.log(`\n[미검출/가능성] ${a} (${st.fnItems.length})\n  - ` + st.fnItems.slice(0, 12).join("\n  - "));
    if (st.fpItems.length) console.log(`\n[과잉 확정] ${a} (${st.fpItems.length})\n  - ` + st.fpItems.slice(0, 8).join("\n  - "));
  }
}
