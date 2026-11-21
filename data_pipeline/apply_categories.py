"""
apply_categories.py — 통합 카테고리를 Neo4j Food 노드에 저장하는 스크립트

[역할]
    기존 데이터(식약처식 분류)와 이마트 데이터(마트 진열식 분류)를 하나로 맞춘
    clean/category_map.csv 를 읽어, 모든 Food 노드에 아래 두 속성을 SET 한다.
        unified_major : 통합 대분류 (9개: 간편식, 간식, 음료, 베이커리·잼, 반찬, 식재료, 양념, 유제품, 주류)
        unified_mid   : 통합 중분류
    원래 속성 category_major / category_mid 는 건드리지 않는다 (대체음식 추천이 category_mid 를 그대로 쓴다).
    같은 CSV 로 여러 번 실행해도 결과가 같다.

[대응표 규칙] (clean/category_map.csv)
    source_major, source_mid, name_pattern, unified_major, unified_mid, note
    - (category_major, category_mid) 가 같은 줄들을 파일 순서대로 보고, 처음 맞는 줄을 쓴다
    - name_pattern 은 음식 이름에 대한 정규식 (대소문자 무시). 비어 있으면 그 칸의 기본값
    - 어느 줄에도 맞지 않는 음식은 속성을 SET 하지 않고 미리보기에 목록으로 보여준다

[연결] 환경변수
    NEO4J_URI      (기본 bolt://localhost:7687)
    NEO4J_USER     (기본 neo4j)
    NEO4J_PASSWORD (필수, 없으면 에러)

[실행 방법] (PowerShell, data_pipeline 폴더에서)
    $env:NEO4J_PASSWORD="password123"
    python apply_categories.py           # 미리보기만 (DB 변경 없음)
    python apply_categories.py --apply   # 실제 반영

    load_foods.py 로 음식을 새로 적재했다면 이 스크립트도 다시 실행해야 한다.
"""

import csv
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from neo4j import GraphDatabase

# ------------------------------------------------------------------
# 상수 정의
# ------------------------------------------------------------------

MAP_PATH = Path(__file__).resolve().parent / "clean" / "category_map.csv"
BATCH_SIZE = 2000

# 화면에서 통합 카테고리로 목록·필터를 만들 때 쓰는 인덱스
INDEXES = [
    "CREATE INDEX food_unified_major IF NOT EXISTS FOR (f:Food) ON (f.unified_major)",
    "CREATE INDEX food_unified_mid IF NOT EXISTS FOR (f:Food) ON (f.unified_mid)",
]


# ------------------------------------------------------------------
# 1. 대응표 읽기 / 분류
# ------------------------------------------------------------------

def load_rules():
    """(source_major, source_mid) → [(정규식 또는 None, 통합 대분류, 통합 중분류), ...] (파일 순서 유지)"""
    rules = defaultdict(list)
    with open(MAP_PATH, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            pattern = r["name_pattern"].strip()
            rules[(r["source_major"].strip(), r["source_mid"].strip())].append((
                re.compile(pattern, re.IGNORECASE) if pattern else None,
                r["unified_major"].strip(),
                r["unified_mid"].strip(),
            ))
    return rules


def classify(rules, name, major, mid):
    """처음 맞는 규칙의 (통합 대분류, 통합 중분류). 맞는 규칙이 없으면 None"""
    for pattern, u_major, u_mid in rules.get((major, mid), []):
        if pattern is None or pattern.search(name or ""):
            return u_major, u_mid
    return None


# ------------------------------------------------------------------
# 2. DB 연결
# ------------------------------------------------------------------

def connect():
    """환경변수로 Neo4j 드라이버 생성. 비밀번호가 없으면 종료 (load_foods.py 와 같음)"""
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


# ------------------------------------------------------------------
# 3. 분류 계산 + 미리보기
# ------------------------------------------------------------------

def build_updates(session, rules):
    """모든 Food 를 읽어 분류 → (반영할 행 목록, 바뀌는 수, 미분류 Counter)"""
    foods = session.run("""
        MATCH (f:Food)
        RETURN elementId(f) AS id, f.name AS name,
               f.category_major AS major, f.category_mid AS mid,
               f.unified_major AS old_major, f.unified_mid AS old_mid
    """).data()

    updates, changed, unmapped, counts = [], 0, Counter(), Counter()
    for f in foods:
        result = classify(rules, f["name"], f["major"], f["mid"])
        if result is None:
            unmapped[(f["major"], f["mid"])] += 1
            continue
        u_major, u_mid = result
        counts[(u_major, u_mid)] += 1
        if (f["old_major"], f["old_mid"]) != (u_major, u_mid):
            changed += 1
        updates.append({"id": f["id"], "major": u_major, "mid": u_mid})

    print(f"\n전체 Food: {len(foods)}  분류됨: {len(updates)}  미분류: {sum(unmapped.values())}")
    print(f"값이 새로 생기거나 바뀌는 Food: {changed}")

    major_totals = Counter()
    for (u_major, _), n in counts.items():
        major_totals[u_major] += n
    for u_major, total in major_totals.most_common():
        mids = sorted(((m, n) for (a, m), n in counts.items() if a == u_major), key=lambda x: -x[1])
        print(f"  {u_major} {total}: " + ", ".join(f"{m} {n}" for m, n in mids))

    if unmapped:
        print("\n[경고] 대응표에 없는 (category_major, category_mid) — category_map.csv 에 줄을 추가하세요")
        for (major, mid), n in unmapped.most_common():
            print(f"  - {major} / {mid}: {n}")
    return updates


# ------------------------------------------------------------------
# 4. 반영
# ------------------------------------------------------------------

def apply(driver, updates):
    with driver.session() as session:
        for cypher in INDEXES:
            session.run(cypher)
        print("\n인덱스 확인/생성 완료 (Food.unified_major, Food.unified_mid)")

        for i in range(0, len(updates), BATCH_SIZE):
            batch = updates[i:i + BATCH_SIZE]
            session.run("""
                UNWIND $rows AS row
                MATCH (f:Food) WHERE elementId(f) = row.id
                SET f.unified_major = row.major, f.unified_mid = row.mid
            """, rows=batch)
        print(f"반영 완료: {len(updates)}개 Food")

        missing = session.run("MATCH (f:Food) WHERE f.unified_major IS NULL RETURN count(f) AS n").single()["n"]
        print(f"통합 카테고리가 없는 Food: {missing}")


# ------------------------------------------------------------------
# 5. 메인
# ------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    if args not in ([], ["--apply"]):
        print("사용법: python apply_categories.py [--apply]")
        sys.exit(1)
    do_apply = args == ["--apply"]

    rules = load_rules()
    driver = connect()
    try:
        with driver.session() as session:
            updates = build_updates(session, rules)

        if not do_apply:
            print("\n미리보기만 실행했습니다 (DB 변경 없음). 실제 반영: python apply_categories.py --apply")
            return

        apply(driver, updates)
    finally:
        driver.close()


if __name__ == "__main__":
    main()
