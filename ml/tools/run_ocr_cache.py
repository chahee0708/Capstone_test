"""
run_ocr_cache.py
- 역할: 라벨 사진 폴더를 실제 OCR 파이프라인(ocr_pipeline)으로 읽어 결과를 JSON 으로 저장한다.
         저장된 OCR 줄 좌표로 파서 변경을 OCR 재실행 없이 평가할 수 있다 (eval_vs_csv.py --reparse).

입력 폴더 구조:  <input>/<대분류>/<중분류>/<제품명>.png     예) input/유제품/치즈/그라나롤로 부라타 치즈.png
출력:            <out>/<대분류>__<중분류>__<제품명>.json

사용:
  python tools/run_ocr_cache.py --input C:\\...\\ocr\\input --out C:\\...\\cache [--limit 50]

이 도구는 입력 이미지를 읽기만 한다.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import ocr_engine as E  # noqa: E402
import ocr_pipeline as PL  # noqa: E402

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")


def dump(lines):
    return [
        {"t": l.text, "s": round(l.score, 3), "b": [round(l.x0), round(l.y0), round(l.x1), round(l.y1)]}
        for l in lines
    ]


def collect(input_dir: str):
    items = []
    for root, _dirs, files in os.walk(input_dir):
        rel = os.path.relpath(root, input_dir).split(os.sep)
        for f in sorted(files):
            if f.lower().endswith(IMAGE_EXT):
                pid = "__".join(rel[:2] + [os.path.splitext(f)[0]])
                items.append((pid, os.path.join(root, f)))
    items.sort()
    return items


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    items = collect(args.input)
    if args.limit:
        items = items[: args.limit]
    E.warmup(("ko",))
    t_all = time.time()
    for i, (pid, path) in enumerate(items):
        out = os.path.join(args.out, pid + ".json")
        if os.path.exists(out):
            continue
        t0 = time.time()
        try:
            blob = open(path, "rb").read()
            base = E.read_image(blob)
            parsed = PL.parse_ocr_result(base)
            rec = {
                "id": pid, "w": base.width, "h": base.height, "rotation": base.rotation,
                "base_lines": dump(base.lines), "second_lines": None, "second_used": False,
            }
            if PL._needs_second_pass(base, parsed):
                sec = E.invert_pass(blob, base)
                parsed2 = PL.parse_ocr_result(sec)
                rec["second_lines"] = dump(sec.lines)
                if PL._candidate_score(parsed2) >= PL._candidate_score(parsed):
                    parsed, rec["second_used"] = parsed2, True
            parsed.pop("raw_text", None)
            rec["parsed"] = parsed
            rec["elapsed"] = round(time.time() - t0, 1)
        except Exception as exc:  # noqa: BLE001  (한 장의 실패가 전체 실행을 멈추지 않게)
            rec = {"id": pid, "error": f"{type(exc).__name__}: {exc}"}
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)
        if (i + 1) % 10 == 0:
            print(f"{i + 1}/{len(items)}  {time.time() - t_all:.0f}s", flush=True)
    print(f"finished {time.time() - t_all:.0f}s", flush=True)


if __name__ == "__main__":
    main()
