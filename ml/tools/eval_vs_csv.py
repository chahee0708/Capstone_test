"""
eval_vs_csv.py
- 역할: run_ocr_cache.py 가 만든 OCR 결과(JSON 폴더)를 정답 CSV 와 비교해 정확도를 측정한다.

정답 CSV: 사용자의 라벨 수집 프로젝트 산출물(예: manual_foods.csv). 열 — food_category_major, food_category_minor,
          food_name, product_report_no, nutrient_reference_amount, energy_kcal … protein_g, ingredients
연결 방법: 캐시 id(<대분류>__<중분류>__<제품명>) 의 카테고리가 같은 행들 중에서
           제품명 일치 / 품목보고번호 / 원재료명 앞부분 / 영양성분 숫자가 OCR 텍스트에 나타나는 정도로 1:1 연결한다.

식이섬유/칼륨/인은 CSV 에서 카테고리 평균으로 채워진 값이라 라벨에서 읽은 값이 아니므로 평가에서 제외한다.

사용:
  python tools/eval_vs_csv.py --csv C:\\...\\manual_foods.csv --cache C:\\...\\cache [--reparse] [--show 20]
    --reparse : 저장된 OCR 줄에 현재 파서를 다시 적용한다 (OCR 재실행 없음 — 파서 개선 효과 측정용)
"""

from __future__ import annotations

import argparse
import collections
import csv
import difflib
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import label_parser as P  # noqa: E402
import ocr_engine as OE  # noqa: E402
import ocr_pipeline as PL  # noqa: E402

csv.field_size_limit(10**9)
EXCLUDED = {"dietary_fiber_g", "potassium_mg", "phosphorus_mg"}


def compact(s):
    return re.sub(r"\s+", "", s or "")


def num(v):
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def close(a, b):
    if a is None or b is None:
        return False
    return abs(a - b) <= max(0.06, abs(b) * 0.01)


def sim(a, b):
    a, b = compact(a), compact(b)
    if not a or not b:
        return 0.0
    if max(len(a), len(b)) >= 700:
        return difflib.SequenceMatcher(None, a, b).quick_ratio()
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def to_lines(arr):
    return [OE.OcrLine(x["t"], float(x["s"]), *[float(v) for v in x["b"]]) for x in arr]


def match_score(row, text, pid):
    """(점수, 연결 가능 여부).

    같은 카테고리의 서로 다른 제품은 원재료 문구("밀가루(밀:미국산)…")나 숫자가 우연히 겹치므로,
    제품 고유의 근거(제품명, 품목보고번호, 원재료명 여러 군데, 영양성분 숫자 여러 개)가 겹칠 때만 연결한다.
    """
    fn = compact(row.get("food_name"))
    title = compact(pid.split("__", 2)[-1])
    name_exact = bool(fn) and fn == title
    name_in_text = bool(fn) and len(fn) >= 4 and fn in text

    no = re.sub(r"\D", "", row.get("product_report_no") or "")
    report_hit = len(no) >= 10 and no in text

    # 원재료명: 정답의 앞/중간/뒤 14글자 조각 가운데 OCR 텍스트에 (거의) 그대로 나타나는 조각 수
    ing_chunks = 0
    ing = compact(row.get("ingredients"))
    if len(ing) >= 30:
        n = len(ing)
        for start in (0, max(0, n // 2 - 7), max(0, n - 14)):
            chunk = ing[start: start + 14]
            if len(chunk) < 12:
                continue
            if chunk in text:
                ing_chunks += 1
            else:
                m = difflib.SequenceMatcher(None, text, chunk, autojunk=False).find_longest_match(
                    0, len(text), 0, len(chunk))
                if m.size / len(chunk) >= 0.8:
                    ing_chunks += 1

    # 영양성분: 0 이 아닌 값 중 "이름+값" 이 OCR 텍스트에 나타나는 개수
    hit = tot = 0
    for key, nm in (("sodium_mg", "나트륨"), ("protein_g", "단백질"), ("carbohydrate_g", "탄수화물"),
                    ("sugar_g", "당류"), ("fat_g", "지방"), ("energy_kcal", "kcal"), ("saturated_fat_g", "포화지방")):
        v = num(row.get(key))
        if v is None or v == 0:
            continue
        tot += 1
        txt = f"{v:g}"
        pat = (re.escape(txt) + r"\s*kcal") if key == "energy_kcal" else (nm + r"[^가-힣]{0,3}" + re.escape(txt))
        if re.search(pat, text, re.I):
            hit += 1

    ok = (
        name_exact
        or report_hit
        or ing_chunks >= 2
        or (hit >= 4 and tot and hit / tot >= 0.7)
        or (hit >= 3 and (name_in_text or ing_chunks >= 1))
    )
    score = 6 * name_exact + 5 * report_hit + 3 * ing_chunks + 1.5 * hit + 2 * name_in_text
    return score, ok


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--reparse", action="store_true")
    ap.add_argument("--show", type=int, default=0)
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.csv, encoding="utf-8-sig", newline="")))
    by_cat = collections.defaultdict(list)
    for i, r in enumerate(rows):
        by_cat[(r["food_category_major"], r["food_category_minor"])].append(i)

    recs, errors = [], 0
    for f in sorted(glob.glob(os.path.join(args.cache, "*.json"))):
        rec = json.load(open(f, encoding="utf-8"))
        if "error" in rec:
            errors += 1
        elif "base_lines" in rec:
            recs.append(rec)
    print(f"OCR 결과 {len(recs)}건 (오류 {errors}건), 정답 행 {len(rows)}개")

    pairs = []
    for rec in recs:
        parts = rec["id"].split("__")
        text = compact("".join(l["t"] for l in rec["base_lines"]) +
                       "".join(l["t"] for l in (rec.get("second_lines") or [])))
        for i in by_cat.get((parts[0], parts[1]), []):
            sc, ok = match_score(rows[i], text, rec["id"])
            if ok:
                pairs.append((sc, rec["id"], i))
    pairs.sort(key=lambda t: -t[0])
    assigned, used = {}, set()
    for sc, pid, i in pairs:
        if pid in assigned or i in used:
            continue
        assigned[pid] = i
        used.add(i)
    print(f"정답과 연결된 항목: {len(assigned)} / {len(recs)}")

    stats = collections.defaultdict(lambda: {"truth": 0, "hit": 0, "wrong": 0, "miss": 0})
    ing_sims, ref_hit, ref_tot, sec_run, sec_used, elapsed, fails = [], 0, 0, 0, 0, [], []
    for rec in recs:
        if rec["id"] not in assigned:
            continue
        row = rows[assigned[rec["id"]]]
        if args.reparse:
            base = OE.OcrResult(lines=to_lines(rec["base_lines"]), width=rec["w"], height=rec["h"],
                                rotation=rec.get("rotation", 0))
            parsed = PL.parse_ocr_result(base)
            if rec.get("second_lines"):
                sec = OE.OcrResult(lines=to_lines(rec["second_lines"]), width=rec["w"], height=rec["h"],
                                   rotation=rec.get("rotation", 0))
                parsed2 = PL.parse_ocr_result(sec)
                if PL._candidate_score(parsed2) >= PL._candidate_score(parsed):
                    parsed = parsed2
        else:
            parsed = rec["parsed"]
        sec_run += 1 if rec.get("second_lines") else 0
        sec_used += 1 if rec.get("second_used") else 0
        if rec.get("elapsed"):
            elapsed.append(rec["elapsed"])
        for k in P.NUTRIENT_KEYS:
            if k in EXCLUDED:
                continue
            t, p = num(row.get(k)), parsed["nutrition"].get(k)
            if t is None:
                continue
            s = stats[k]
            s["truth"] += 1
            if close(p, t):
                s["hit"] += 1
            elif p is None:
                s["miss"] += 1
                fails.append((rec["id"], k, t, p))
            else:
                s["wrong"] += 1
                fails.append((rec["id"], k, t, p))
        if row.get("ingredients"):
            ing_sims.append(sim(parsed.get("ingredients") or "", row["ingredients"]))
        m = re.search(r"(\d+(?:\.\d+)?)\s*(?:g|ml|mL)", row.get("nutrient_reference_amount") or "")
        if m:
            ref_tot += 1
            amt = parsed["reference"].get("amount")
            if amt is not None and abs(amt - float(m.group(1))) < 0.5:
                ref_hit += 1

    print(f"\n{'항목':<17}{'정답수':>6}{'일치':>6}{'오답':>6}{'누락':>6}{'일치율':>8}")
    tt = th = 0
    for k in P.NUTRIENT_KEYS:
        s = stats[k]
        if not s["truth"]:
            continue
        tt += s["truth"]
        th += s["hit"]
        print(f"{k:<17}{s['truth']:>6}{s['hit']:>6}{s['wrong']:>6}{s['miss']:>6}{s['hit'] / s['truth'] * 100:>7.1f}%")
    print(f"\n영양성분 전체 일치율: {th}/{tt} = {th / max(1, tt) * 100:.1f}%")
    print(f"기준량 일치: {ref_hit}/{ref_tot} = {ref_hit / max(1, ref_tot) * 100:.1f}%")
    if ing_sims:
        print(f"원재료명 유사도 평균 {sum(ing_sims) / len(ing_sims):.3f}  "
              f"(0.9 이상 {sum(1 for x in ing_sims if x >= 0.9)}/{len(ing_sims)}, "
              f"0.7 이상 {sum(1 for x in ing_sims if x >= 0.7)}/{len(ing_sims)})")
    if elapsed:
        print(f"처리 시간 평균 {sum(elapsed) / len(elapsed):.1f}s / 최대 {max(elapsed):.1f}s, "
              f"2차 패스 실행 {sec_run}건 (채택 {sec_used}건)")
    if args.show:
        print("\n── 실패 사례 ──")
        for pid, k, t, p in fails[: args.show]:
            print(f"  {pid[:44]:<46}{k:<16} 정답={t}  예측={p}")


if __name__ == "__main__":
    main()
