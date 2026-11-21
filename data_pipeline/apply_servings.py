"""
apply_servings.py — Food 노드에 "1개당 양"과 "총 내용량"을 숫자로 저장하는 스크립트

[역할]
    분석 화면에서 영양성분을 100g(ml)당뿐 아니라 1개당 / 전체로도 보여주려면
    1개의 양과 총 내용량이 숫자로 필요하다. Food 노드에 아래 속성을 SET 한다.
        piece_amount : 1개(1봉지 등)의 양 (g 또는 ml, serving_unit 과 같은 단위)
        piece_label  : 1개를 부르는 말 (예: "1개", "1봉지")
        total_amount : 총 내용량 (g 또는 ml)
    영양성분 값(100g/100ml 기준)은 건드리지 않는다. 화면이 값 × 양 ÷ 100 으로 환산한다.

[데이터별 규칙]
    이마트 데이터 (data_source='emart') : raw/manual_foods.csv 의 food_weight, serving_size 를 report_no 로 연결
        - food_weight 에 "75mL x 8개" 처럼 낱개가 있으면 → 1개 = 75mL, 이름 = "1개"
        - 없으면 serving_size 가 "1봉지 (39g)" 꼴일 때 → 1개 = 39g, 이름 = "1봉지"
        - 둘 다 없으면 총 내용량을 1개로 본다 (예: 새우깡 90g)
        - 1.8L 처럼 L/kg 은 ml/g 으로 바꾼다
    기존 데이터 : 노드의 food_weight (예: "120g") 를 총 내용량이자 1개로 본다
                 (serving_size 는 식품유형 설명 글이 섞여 있어 쓰지 않는다)
    단위가 영양성분 기준 단위(g/ml)와 다르면 SET 하지 않는다 (예: 100g 기준인데 내용량이 ml)

[실행 방법] (PowerShell, data_pipeline 폴더에서)
    $env:NEO4J_PASSWORD="password123"
    python apply_servings.py           # 미리보기만 (DB 변경 없음)
    python apply_servings.py --apply   # 실제 반영

    load_foods.py 로 음식을 새로 적재했다면 이 스크립트도 다시 실행해야 한다.
"""

import csv
import os
import re
import sys
from collections import Counter
from pathlib import Path

from neo4j import GraphDatabase

RAW_PATH = Path(__file__).resolve().parent / "raw" / "manual_foods.csv"
BATCH_SIZE = 2000

# 숫자 + 단위. 1,350mL 처럼 쉼표가 있어도 읽는다. kcal 은 단위로 보지 않는다
AMOUNT = r"([\d][\d,]*(?:\.\d+)?)\s*(kg|g|ml|l)(?![a-z])"
# 낱개 표기: "75mL x 8개", "39gX9봉지", "35g*4봉", "500gx2개"
PIECE_IN_WEIGHT = re.compile(AMOUNT + r"\s*[x×*]\s*\d+\s*([가-힣]*)", re.IGNORECASE)
# 1회 제공량 표기: "1봉지 (39g)", "1개(75mL)"
PIECE_IN_SERVING = re.compile(r"^\s*1\s*([가-힣]+)\s*\(?\s*" + AMOUNT, re.IGNORECASE)
FIRST_AMOUNT = re.compile(AMOUNT, re.IGNORECASE)

# 낱개 단위 이름 정리 (개입 → 개)
LABEL_FIX = {"개입": "개", "": "개"}


def to_base(number, unit):
    """("1.8", "L") → (1800.0, "ml")"""
    value = float(number.replace(",", ""))
    unit = unit.lower()
    if unit == "kg":
        return value * 1000, "g"
    if unit == "l":
        return value * 1000, "ml"
    return value, unit


def parse_total(food_weight):
    """총 내용량: 첫 번째 숫자+단위. 없으면 None"""
    m = FIRST_AMOUNT.search(food_weight or "")
    return to_base(m.group(1), m.group(2)) if m else None


def parse_piece_emart(food_weight, serving_size):
    """이마트 데이터의 1개 양 → (양, 단위, 이름) 또는 None"""
    m = PIECE_IN_WEIGHT.search(food_weight or "")
    if m:
        amount, unit = to_base(m.group(1), m.group(2))
        word = m.group(3)
        return amount, unit, "1" + LABEL_FIX.get(word, word)
    m = PIECE_IN_SERVING.search(serving_size or "")
    if m:
        amount, unit = to_base(m.group(2), m.group(3))
        word = m.group(1)
        return amount, unit, "1" + LABEL_FIX.get(word, word)
    total = parse_total(food_weight)
    return (total[0], total[1], "1개") if total else None


def basis_unit(node):
    """영양성분 기준 단위: 이마트는 serving_unit, 기존 데이터는 nutrient_reference_amount ("100ml")"""
    if node.get("serving_unit"):
        return node["serving_unit"].lower()
    ref = (node.get("ref") or "").lower()
    return "ml" if ref.endswith("ml") else "g"


def connect():
    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD")
    if not password:
        print("에러: 환경변수 NEO4J_PASSWORD 가 설정되지 않았습니다.")
        print('  PowerShell 예) $env:NEO4J_PASSWORD="비밀번호"')
        sys.exit(1)
    driver = GraphDatabase.driver(uri, auth=(user, password), notifications_min_severity="OFF")
    driver.verify_connectivity()
    print(f"Neo4j 연결: {uri} (user={user})")
    return driver


def load_raw():
    """report_no → (food_weight, serving_size)"""
    with open(RAW_PATH, encoding="utf-8-sig", newline="") as f:
        return {
            r["product_report_no"].strip(): (r["food_weight"], r["serving_size"])
            for r in csv.DictReader(f)
        }


def build_updates(session, raw):
    nodes = session.run("""
        MATCH (f:Food)
        RETURN elementId(f) AS id, f.name AS name, f.data_source AS source,
               f.report_no AS report_no, f.food_weight AS food_weight,
               f.serving_unit AS serving_unit, f.nutrient_reference_amount AS ref
    """).data()

    updates, skipped, labels, samples = [], Counter(), Counter(), []
    for n in nodes:
        unit = basis_unit(n)
        if n["source"] == "emart":
            weight, serving = raw.get(str(n["report_no"]), (None, None))
            piece = parse_piece_emart(weight, serving)
            total = parse_total(weight)
        else:
            total = parse_total(n["food_weight"])
            piece = (total[0], total[1], "1개") if total else None

        if not piece or not total:
            skipped["내용량 없음"] += 1
            continue
        if piece[1] != unit or total[1] != unit:
            skipped["단위 다름"] += 1
            continue
        if piece[0] <= 0:
            skipped["0 이하"] += 1
            continue

        labels[piece[2]] += 1
        updates.append({"id": n["id"], "piece": piece[0], "label": piece[2], "total": total[0]})
        if n["source"] == "emart" and len(samples) < 12:
            samples.append(f"{n['name']}: {piece[2]} {piece[0]:g}{unit} / 전체 {total[0]:g}{unit}  ← {weight} | {serving}")

    print(f"\n전체 Food: {len(nodes)}  반영: {len(updates)}  건너뜀: {dict(skipped)}")
    print("1개 이름:", ", ".join(f"{k} {v}" for k, v in labels.most_common(10)))
    print("이마트 예시:")
    for s in samples:
        print("  " + s)
    return updates


def apply(driver, updates):
    with driver.session() as session:
        for i in range(0, len(updates), BATCH_SIZE):
            session.run("""
                UNWIND $rows AS row
                MATCH (f:Food) WHERE elementId(f) = row.id
                SET f.piece_amount = row.piece, f.piece_label = row.label, f.total_amount = row.total
            """, rows=updates[i:i + BATCH_SIZE])
        print(f"\n반영 완료: {len(updates)}개 Food")


def main():
    args = sys.argv[1:]
    if args not in ([], ["--apply"]):
        print("사용법: python apply_servings.py [--apply]")
        sys.exit(1)

    raw = load_raw()
    driver = connect()
    try:
        with driver.session() as session:
            updates = build_updates(session, raw)
        if args != ["--apply"]:
            print("\n미리보기만 실행했습니다 (DB 변경 없음). 실제 반영: python apply_servings.py --apply")
            return
        apply(driver, updates)
    finally:
        driver.close()


if __name__ == "__main__":
    main()
