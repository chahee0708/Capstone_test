"""
eval_label_parser.py
- 역할: 라벨 파서(label_parser.parse_label)의 정확도를 정답 데이터로 측정한다.

정답 데이터 구조 (사용자의 라벨 수집 프로젝트):
  <items_dir>/<id>/result.json        정답 행 (row.energy_kcal, row.ingredients, row.nutrient_reference_amount …)
  <items_dir>/<id>/ocr_google.json    구글 OCR 텍스트 (--source google)
  <cache_dir>/<id>.json               ocr_engine 결과 캐시 (--source cache, 아래 cache_ocr.py 형식)

사용:
  python eval_label_parser.py --items <items_dir> --source google
  python eval_label_parser.py --items <items_dir> --source cache --cache <cache_dir> [--show-fails 15]
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import label_parser as P  # noqa: E402
import ocr_pipeline  # noqa: E402


def load_truth(path: str):
    try:
        r = json.load(open(path, encoding="utf-8"))
    except Exception:
        return None
    return r.get("row") or None


def text_from_google(item_dir: str, kind: str) -> str:
    p = os.path.join(item_dir, "ocr_google.json")
    if not os.path.exists(p):
        return ""
    g = json.load(open(p, encoding="utf-8"))
    return "\n".join(t.get(kind, "") for im in g for t in im.get("tiles", []))


def result_from_cache(cache_dir: str, item_id: str):
    """ocr_engine 캐시(JSON) → OcrResult. 없거나 오류 기록이면 None."""
    import ocr_engine as OE

    p = os.path.join(cache_dir, item_id + ".json")
    if not os.path.exists(p):
        return None
    rec = json.load(open(p, encoding="utf-8"))
    if "lines" not in rec:
        return None
    lines = [OE.OcrLine(l["t"], float(l["s"]), *[float(v) for v in l["b"]]) for l in rec["lines"]]
    return OE.OcrResult(lines=lines, width=int(rec.get("w", 0)), height=int(rec.get("h", 0)), rotation=int(rec.get("rotation", 0)))


def ref_amount(s):
    if not s:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(g|ml|mL)", str(s))
    return float(m.group(1)) if m else None


def close(a, b):
    if a is None or b is None:
        return False
    return abs(a - b) <= max(0.06, abs(b) * 0.01)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", required=True)
    ap.add_argument("--source", choices=["google", "google-flow", "cache"], default="google")
    ap.add_argument("--cache")
    ap.add_argument("--show-fails", type=int, default=0)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    ids = sorted(d for d in os.listdir(args.items) if os.path.isdir(os.path.join(args.items, d)))
    stats = defaultdict(lambda: {"truth": 0, "hit": 0, "pred_when_null": 0, "null_truth": 0, "miss": 0, "wrong": 0})
    ref_total = ref_hit = 0
    ing_sims = []
    ing_total = ing_present = 0
    fails = []
    n_items = 0
    status_count = defaultdict(int)

    for d in ids:
        truth = load_truth(os.path.join(args.items, d, "result.json"))
        if not truth:
            continue
        if args.source == "cache":
            ocr_result = result_from_cache(args.cache, d)
            if ocr_result is None:
                continue
            n_items += 1
            if args.limit and n_items > args.limit:
                break
            res = ocr_pipeline.parse_ocr_result(ocr_result)  # 운영(analyze_label_images)과 같은 경로
        else:
            text = text_from_google(os.path.join(args.items, d), "layout" if args.source == "google" else "flow")
            n_items += 1
            if args.limit and n_items > args.limit:
                break
            res = P.parse_label(text, avg_ocr_score=1.0)
        status_count[res["status"]] += 1

        for k in P.NUTRIENT_KEYS:
            t = truth.get(k)
            p = res["nutrition"].get(k)
            s = stats[k]
            if t is None:
                s["null_truth"] += 1
                if p is not None:
                    s["pred_when_null"] += 1
            else:
                s["truth"] += 1
                if close(p, float(t)):
                    s["hit"] += 1
                elif p is None:
                    s["miss"] += 1
                    fails.append((d, k, t, p))
                else:
                    s["wrong"] += 1
                    fails.append((d, k, t, p))

        ta = ref_amount(truth.get("nutrient_reference_amount"))
        if ta is not None:
            ref_total += 1
            if res["reference"]["amount"] is not None and abs(res["reference"]["amount"] - ta) < 0.5:
                ref_hit += 1

        t_ing = truth.get("ingredients")
        if t_ing:
            ing_total += 1
            if res["ingredients"]:
                ing_present += 1
                a = P.compact(res["ingredients"])
                b = P.compact(t_ing)
                ing_sims.append(difflib.SequenceMatcher(None, a, b, autojunk=False).quick_ratio() if len(a) > 400 else difflib.SequenceMatcher(None, a, b).ratio())

    print(f"평가 항목 수: {n_items}   상태: {dict(status_count)}\n")
    print(f"{'항목':<18}{'정답수':>6}{'일치':>6}{'오답':>6}{'누락':>6}{'일치율':>8}{'null정답중_추출':>16}")
    tot_t = tot_h = 0
    for k in P.NUTRIENT_KEYS:
        s = stats[k]
        if s["truth"] == 0:
            continue
        tot_t += s["truth"]
        tot_h += s["hit"]
        print(f"{k:<18}{s['truth']:>6}{s['hit']:>6}{s['wrong']:>6}{s['miss']:>6}{s['hit'] / s['truth'] * 100:>7.1f}%{s['pred_when_null']:>10}/{s['null_truth']}")
    print(f"\n영양성분 전체 일치율: {tot_h}/{tot_t} = {tot_h / max(1, tot_t) * 100:.1f}%")
    print(f"기준량 일치: {ref_hit}/{ref_total} = {ref_hit / max(1, ref_total) * 100:.1f}%")
    if ing_total:
        avg_sim = sum(ing_sims) / max(1, len(ing_sims))
        print(f"원재료명: 추출 {ing_present}/{ing_total}, 평균 유사도 {avg_sim:.3f}, 0.9 이상 {sum(1 for x in ing_sims if x >= 0.9)}건")

    if args.show_fails:
        print("\n── 실패 사례 ──")
        for d, k, t, p in fails[: args.show_fails]:
            print(f"{d[:40]:<42}{k:<18} 정답={t}  예측={p}")


if __name__ == "__main__":
    main()
