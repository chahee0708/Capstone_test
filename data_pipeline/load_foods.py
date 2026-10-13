"""
load_foods.py — 정제된 식품 데이터를 Neo4j 에 적재하는 스크립트

[역할]
    clean_foods.py 가 만든 clean/foods_clean.csv 를 Neo4j 에 적재한다.
    - Food 노드      : report_no 기준 MERGE 후 속성 SET (data_source='emart', alt_candidate=true)
    - Ingredient 노드: ingredient_list 순서대로 HAS_INGREDIENT {order} 관계 생성
    - Allergy 노드   : allergen_list 로 CONTAINS_ALLERGEN 관계 생성, group 은 allergen_groups.csv 값
    기존 BELONGS_TO(Category), HAS_NUTRIENT 관계와 이번 CSV 에 없는 Food 노드는 건드리지 않는다.
    같은 CSV 로 여러 번 실행해도 결과가 같다 (관계는 매번 지우고 다시 만든다).

[입력] (data_pipeline/clean/)
    - foods_clean.csv     : clean_foods.py 출력
    - allergen_groups.csv : 알레르기 이름 → 묶음 그룹 (name, group)

[연결] 환경변수
    NEO4J_URI      (기본 bolt://localhost:7687)
    NEO4J_USER     (기본 neo4j)
    NEO4J_PASSWORD (필수, 없으면 에러)

[실행 방법] (PowerShell)
    $env:NEO4J_PASSWORD="password123"
    python load_foods.py           # 미리보기만 (DB 변경 없음)
    python load_foods.py --apply   # 실제 적재
"""

import os
import sys
from pathlib import Path

import pandas as pd
from neo4j import GraphDatabase

# ------------------------------------------------------------------
# 상수 정의
# ------------------------------------------------------------------

CLEAN_DIR = Path(__file__).resolve().parent / "clean"
FOODS_PATH = CLEAN_DIR / "foods_clean.csv"
GROUPS_PATH = CLEAN_DIR / "allergen_groups.csv"

# 문자열로 저장할 Food 속성
TEXT_PROPS = ["name", "company", "serving_unit", "category_major", "category_mid", "data_creation_date"]
# 숫자(float)로 저장할 영양소 속성 12개
NUMBER_PROPS = [
    "calories", "carbohydrate", "sugar", "fat", "saturated_fat", "trans_fat",
    "cholesterol", "protein", "sodium", "fiber", "potassium", "phosphorus",
]

DATA_SOURCE = "emart"
BATCH_SIZE = 100

CONSTRAINTS = [
    "CREATE CONSTRAINT food_report_no IF NOT EXISTS FOR (f:Food) REQUIRE f.report_no IS UNIQUE",
    "CREATE CONSTRAINT ingredient_name IF NOT EXISTS FOR (i:Ingredient) REQUIRE i.name IS UNIQUE",
    "CREATE CONSTRAINT allergy_name IF NOT EXISTS FOR (a:Allergy) REQUIRE a.name IS UNIQUE",
]


# ------------------------------------------------------------------
# 1. CSV 읽기 → 적재용 행 만들기
# ------------------------------------------------------------------

def split_list(value):
    """ "a|b|c" → ["a", "b", "c"]. 빈 값이면 [] """
    if pd.isna(value) or not str(value).strip():
        return []
    return [v for v in str(value).split("|") if v]


def load_rows():
    """
    foods_clean.csv 를 읽어 적재용 dict 목록을 만든다.
    - report_no 는 문자열 그대로 (dtype=str → 앞자리 0 보존)
    - 빈 칸인 속성은 props 에 넣지 않는다 → SET 되지 않음 (0 으로 넣지 않음)
    """
    df = pd.read_csv(FOODS_PATH, dtype=str, encoding="utf-8-sig")
    groups_df = pd.read_csv(GROUPS_PATH, dtype=str, encoding="utf-8-sig")
    groups = dict(zip(groups_df["name"], groups_df["group"]))

    rows = []
    for _, r in df.iterrows():
        props = {}
        for col in TEXT_PROPS:
            if pd.notna(r[col]) and str(r[col]).strip():
                props[col] = str(r[col]).strip()
        for col in NUMBER_PROPS:
            if pd.notna(r[col]) and str(r[col]).strip():
                props[col] = float(r[col])
        rows.append({
            "report_no": str(r["report_no"]).strip(),
            "props": props,
            # 원재료: 순번(1부터) 포함
            "ingredients": [{"name": n, "order": i} for i, n in enumerate(split_list(r["ingredient_list"]), 1)],
            # 알레르기: 그룹 파일에 없으면 group = name
            "allergens": [{"name": n, "group": groups.get(n, n)} for n in split_list(r["allergen_list"])],
        })
    return rows


# ------------------------------------------------------------------
# 2. DB 연결
# ------------------------------------------------------------------

def connect():
    """환경변수로 Neo4j 드라이버 생성. 비밀번호가 없으면 종료"""
    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD")
    if not password:
        print("에러: 환경변수 NEO4J_PASSWORD 가 설정되지 않았습니다.")
        print('  PowerShell 예) $env:NEO4J_PASSWORD="비밀번호"')
        sys.exit(1)
    # 서버 알림(예: 아직 없는 속성 키 data_source 경고)은 출력하지 않음
    driver = GraphDatabase.driver(uri, auth=(user, password), notifications_min_severity="OFF")
    driver.verify_connectivity()
    print(f"Neo4j 연결: {uri} (user={user})")
    return driver


def query(session, cypher, **params):
    """읽기 쿼리 실행 → dict 목록"""
    return [r.data() for r in session.run(cypher, **params)]


# ------------------------------------------------------------------
# 3. 미리보기 (DB 변경 없음)
# ------------------------------------------------------------------

def count_duplicates(session):
    """
    기존 Food 의 report_no 중복 수, Ingredient 의 name 중복 수.
    (중복된 값의 개수, 그 값을 가진 노드 수) 형태로 반환
    """
    food = query(session, """
        MATCH (f:Food) WHERE f.report_no IS NOT NULL
        WITH toString(f.report_no) AS key, count(*) AS c WHERE c > 1
        RETURN count(key) AS keys, coalesce(sum(c), 0) AS nodes
    """)[0]
    ing = query(session, """
        MATCH (i:Ingredient) WHERE i.name IS NOT NULL
        WITH i.name AS key, count(*) AS c WHERE c > 1
        RETURN count(key) AS keys, coalesce(sum(c), 0) AS nodes
    """)[0]
    return food, ing


def preview(session, rows):
    """적재 전 영향 범위 출력. 중복 여부(bool)를 반환 → 제약조건 생성 판단에 사용"""
    report_nos = [r["report_no"] for r in rows]

    # 1) CSV 전체 행 수
    print(f"\n1) CSV 전체 행 수: {len(rows)}")

    # 2) report_no 가 같은 기존 Food (덮어쓰기 예정) / 새로 생길 수
    #    report_no 가 숫자로 저장된 노드도 찾도록 toString 비교, 문자열이 아닌 것은 따로 표시
    existing = query(session, """
        MATCH (f:Food) WHERE f.report_no IS NOT NULL AND toString(f.report_no) IN $nos
        RETURN toString(f.report_no) AS report_no, valueType(f.report_no) STARTS WITH 'STRING' AS is_text
    """, nos=report_nos)
    existing_nos = {e["report_no"] for e in existing}
    non_text = [e["report_no"] for e in existing if not e["is_text"]]
    print(f"\n2) 기존 Food 와 report_no 가 같은 수 (덮어쓰기 예정): {len(existing_nos)}")
    print(f"   새로 생길 Food 수: {len(set(report_nos) - existing_nos)}")
    if non_text:
        print(f"   [경고] report_no 가 문자열이 아닌 기존 Food {len(non_text)}개 → MERGE 시 별도 노드가 생김: {non_text[:10]}")

    # 3) report_no 는 다른데 name 이 기존 Food 와 같은 목록 (백엔드가 name 으로 Food 를 찾음 → 중복 위험)
    name_rows = [{"report_no": r["report_no"], "name": r["props"].get("name")} for r in rows if r["props"].get("name")]
    clashes = query(session, """
        UNWIND $rows AS row
        MATCH (f:Food {name: row.name})
        WHERE f.report_no IS NULL OR toString(f.report_no) <> row.report_no
        RETURN row.name AS name, row.report_no AS csv_report_no,
               toString(f.report_no) AS db_report_no, f.data_source AS db_source
        ORDER BY name
    """, rows=name_rows)
    print(f"\n3) report_no 는 다른데 name 이 기존 Food 와 같은 목록: {len(clashes)}건")
    for c in clashes:
        print(f"   - {c['name']}  (CSV report_no={c['csv_report_no']}, "
              f"기존 report_no={c['db_report_no']}, 기존 data_source={c['db_source']})")

    # 4) 기존 데이터 중복 (제약조건 생성 가능 여부)
    food_dup, ing_dup = count_duplicates(session)
    print(f"\n4) 기존 Food 중 report_no 중복: {food_dup['keys']}개 값 ({food_dup['nodes']}개 노드)")
    print(f"   기존 Ingredient 중 name 중복: {ing_dup['keys']}개 값 ({ing_dup['nodes']}개 노드)")
    return food_dup["keys"] > 0 or ing_dup["keys"] > 0


# ------------------------------------------------------------------
# 4. 적재 (--apply)
# ------------------------------------------------------------------

# (1) Food MERGE + 속성 SET. 빈 값은 props 에 없으므로 SET 되지 않음
UPSERT_FOOD = """
UNWIND $rows AS row
MERGE (f:Food {report_no: row.report_no})
SET f += row.props, f.data_source = $source, f.alt_candidate = true
"""

# (2) 이번에 적재하는 Food 의 기존 원재료·알레르기 관계만 삭제 (다른 관계는 그대로)
DELETE_RELS = """
UNWIND $rows AS row
MATCH (f:Food {report_no: row.report_no})-[r:HAS_INGREDIENT|CONTAINS_ALLERGEN]->()
DELETE r
"""

# (3) 원재료 순서대로 Ingredient MERGE + HAS_INGREDIENT {order} 생성
CREATE_INGREDIENTS = """
UNWIND $rows AS row
MATCH (f:Food {report_no: row.report_no})
UNWIND row.ingredients AS ing
MERGE (i:Ingredient {name: ing.name})
CREATE (f)-[:HAS_INGREDIENT {order: ing.order}]->(i)
"""

# (4) Allergy MERGE + group SET + CONTAINS_ALLERGEN 생성
CREATE_ALLERGENS = """
UNWIND $rows AS row
MATCH (f:Food {report_no: row.report_no})
UNWIND row.allergens AS al
MERGE (a:Allergy {name: al.name})
SET a.group = al.group
MERGE (f)-[:CONTAINS_ALLERGEN]->(a)
"""


def write_batch(tx, batch):
    """한 배치(최대 100행)를 한 트랜잭션에서 (1)→(4) 순서로 처리"""
    tx.run(UPSERT_FOOD, rows=batch, source=DATA_SOURCE).consume()
    tx.run(DELETE_RELS, rows=batch).consume()
    tx.run(CREATE_INGREDIENTS, rows=batch).consume()
    tx.run(CREATE_ALLERGENS, rows=batch).consume()


def apply(driver, rows, has_duplicates):
    # 제약조건: 기존 중복이 없을 때만 생성 (중복이 있으면 생성이 실패하므로 경고만)
    if has_duplicates:
        print("\n[경고] 기존 데이터에 중복이 있어 제약조건을 만들지 않았습니다. 중복 정리 후 다시 실행하세요.")
    else:
        with driver.session() as session:
            for c in CONSTRAINTS:
                session.run(c).consume()
        print("\n제약조건 확인/생성 완료 (Food.report_no, Ingredient.name, Allergy.name UNIQUE)")

    # 100행씩 나눠 배치마다 트랜잭션 처리
    with driver.session() as session:
        for start in range(0, len(rows), BATCH_SIZE):
            batch = rows[start:start + BATCH_SIZE]
            session.execute_write(write_batch, batch)
            print(f"  적재 {start + len(batch)}/{len(rows)}")


def report(session):
    """적재 후 결과 출력"""
    stats = query(session, """
        MATCH (f:Food {data_source: $source})
        RETURN count(f) AS foods,
               count(CASE WHEN EXISTS { (f)-[:HAS_INGREDIENT]->() } THEN 1 END) AS with_ing,
               count(CASE WHEN EXISTS { (f)-[:CONTAINS_ALLERGEN]->() } THEN 1 END) AS with_allergen
    """, source=DATA_SOURCE)[0]
    print(f"\n[적재 결과]")
    print(f"data_source='{DATA_SOURCE}' Food 수: {stats['foods']}")
    print(f"  그 중 HAS_INGREDIENT 있는 수    : {stats['with_ing']}")
    print(f"  그 중 CONTAINS_ALLERGEN 있는 수 : {stats['with_allergen']}")

    print("\nAllergy 노드 (name, group):")
    for a in query(session, "MATCH (a:Allergy) RETURN a.name AS name, a.group AS group ORDER BY group, name"):
        print(f"  - {a['name']}, {a['group']}")

    total = query(session, "MATCH (f:Food) RETURN count(f) AS n")[0]["n"]
    print(f"\n전체 Food 수: {total}")


# ------------------------------------------------------------------
# 5. 메인
# ------------------------------------------------------------------

def main():
    # 실행 모드: --apply 일 때만 실제 적재
    args = sys.argv[1:]
    if args not in ([], ["--apply"]):
        print("사용법: python load_foods.py [--apply]")
        sys.exit(1)
    do_apply = args == ["--apply"]

    rows = load_rows()
    driver = connect()
    try:
        with driver.session() as session:
            has_duplicates = preview(session, rows)

        if not do_apply:
            print("\n미리보기만 실행했습니다 (DB 변경 없음). 실제 적재: python load_foods.py --apply")
            return

        apply(driver, rows, has_duplicates)
        with driver.session() as session:
            report(session)
    finally:
        driver.close()


if __name__ == "__main__":
    main()
