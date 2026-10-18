"""
refined_complete_data.csv → 백엔드(backend/services/*.js)가 읽는 스키마로 적재

Neo4j  (foodService.js / allergyService.js 가 기대하는 구조)
  (:Food {name, sugar, sodium, saturated_fat, protein, calories,
          carbohydrate, fat, trans_fat, cholesterol, ...})
  (:Food)-[:HAS_INGREDIENT]->(:Ingredient {name})

MySQL  (fooddb.complete_data — 백엔드는 읽지 않지만 원본 보관용)

사용:  python -I load_backend_schema.py [--neo4j] [--mysql] [--limit N]
접속정보는 docker-compose.yml 의 호스트 포트 기준 (neo4j 7687, mysql 3307).
"""

import argparse
import csv
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
log = logging.getLogger("load")

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, "refined_complete_data.csv")

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_AUTH = (os.environ.get("NEO4J_USER", "neo4j"), os.environ.get("NEO4J_PASSWORD", "password123"))
MYSQL_CONFIG = dict(
    host=os.environ.get("DB_HOST", "localhost"),
    port=int(os.environ.get("DB_PORT", "3307")),
    user=os.environ.get("DB_USER", "root"),
    password=os.environ.get("DB_PASSWORD", "1234"),
    database=os.environ.get("DB_NAME", "fooddb"),
    charset="utf8mb4",
)

# CSV 컬럼 → Neo4j Food 속성 (foodService.getFoodNutrition 의 RETURN 목록과 동일한 이름)
NUM_MAP = {
    "sugar_g": "sugar",
    "sodium_mg": "sodium",
    "saturated_fat_g": "saturated_fat",
    "protein_g": "protein",
    "energy_kcal": "calories",
    "carbohydrate_g": "carbohydrate",
    "fat_g": "fat",
    "trans_fat_g": "trans_fat",
    "cholesterol_mg": "cholesterol",
    "dietary_fiber_g": "dietary_fiber",
    "potassium_mg": "potassium",
    "phosphorus_mg": "phosphorus",
}


def to_float(v):
    v = (v or "").strip()
    if not v or v.lower() == "nan":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def to_str(v):
    v = (v or "").strip()
    return v if v and v.lower() != "nan" else None


def split_ingredients(s):
    """괄호 밖의 쉼표만 구분자로 사용 (예: '밀가루(밀:미국산, 호주산)' 유지)"""
    out, buf, depth = [], [], 0
    for ch in s or "":
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            name = "".join(buf).strip()
            if name:
                out.append(name)
            buf = []
        else:
            buf.append(ch)
    name = "".join(buf).strip()
    if name:
        out.append(name)
    return list(dict.fromkeys(out))  # 중복 제거, 순서 유지


def read_rows(limit=None):
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if limit and i >= limit:
                break
            yield row


def load_neo4j(limit=None, batch_size=2000):
    from neo4j import GraphDatabase

    driver = GraphDatabase.driver(NEO4J_URI, auth=NEO4J_AUTH)
    with driver.session() as s:
        s.run("CREATE CONSTRAINT food_pk IF NOT EXISTS FOR (f:Food) REQUIRE f.product_report_no IS UNIQUE")
        s.run("CREATE CONSTRAINT ingredient_name IF NOT EXISTS FOR (i:Ingredient) REQUIRE i.name IS UNIQUE")
        s.run("CREATE INDEX food_name IF NOT EXISTS FOR (f:Food) ON (f.name)")

        foods, edges = [], []
        for row in read_rows(limit):
            no = to_str(row["product_report_no"])
            name = to_str(row["food_name"])
            if not no or not name:
                continue
            props = {
                "name": name,
                "manufacturer": to_str(row.get("manufacturer")),
                "category_major": to_str(row.get("food_category_major")),
                "category_mid": to_str(row.get("food_category_mid")),
                "category_minor": to_str(row.get("food_category_minor")),
                "food_weight": to_str(row.get("food_weight")),
                "serving_size": to_str(row.get("serving_size")),
                "nutrient_reference_amount": to_str(row.get("nutrient_reference_amount")),
            }
            for col, key in NUM_MAP.items():
                props[key] = to_float(row.get(col))
            # null 속성은 노드에 저장하지 않음 (백엔드 toNum 이 null→0 처리)
            props = {k: v for k, v in props.items() if v is not None}
            foods.append({"no": no, "props": props})
            for ing in split_ingredients(row.get("ingredients")):
                edges.append({"no": no, "name": ing})

        log.info("CSV 파싱 완료: Food %d건, HAS_INGREDIENT %d건", len(foods), len(edges))

        for i in range(0, len(foods), batch_size):
            s.run(
                """
                UNWIND $batch AS r
                MERGE (f:Food {product_report_no: r.no})
                SET f += r.props
                """,
                batch=foods[i:i + batch_size],
            )
        log.info("Food 노드 적재 완료")

        ing_names = [{"name": n} for n in {e["name"] for e in edges}]
        for i in range(0, len(ing_names), batch_size):
            s.run("UNWIND $batch AS r MERGE (:Ingredient {name: r.name})", batch=ing_names[i:i + batch_size])
        log.info("Ingredient 노드 %d건 완료", len(ing_names))

        for i in range(0, len(edges), batch_size):
            s.run(
                """
                UNWIND $batch AS r
                MATCH (f:Food {product_report_no: r.no})
                MATCH (i:Ingredient {name: r.name})
                MERGE (f)-[:HAS_INGREDIENT]->(i)
                """,
                batch=edges[i:i + batch_size],
            )
            if (i // batch_size) % 50 == 0:
                log.info("  HAS_INGREDIENT %d / %d", min(i + batch_size, len(edges)), len(edges))
        log.info("HAS_INGREDIENT 완료")

        for label, q in [
            ("Food", "MATCH (n:Food) RETURN count(n) AS c"),
            ("Ingredient", "MATCH (n:Ingredient) RETURN count(n) AS c"),
            ("HAS_INGREDIENT", "MATCH ()-[r:HAS_INGREDIENT]->() RETURN count(r) AS c"),
        ]:
            log.info("검증 %s: %d", label, s.run(q).single()["c"])
    driver.close()


MYSQL_DDL = """
CREATE TABLE IF NOT EXISTS complete_data (
    product_report_no VARCHAR(50) PRIMARY KEY,
    food_name VARCHAR(255) NOT NULL,
    manufacturer VARCHAR(255),
    main_category VARCHAR(100),
    mid_category VARCHAR(100),
    sub_category VARCHAR(100),
    food_weight VARCHAR(50),
    serving_size VARCHAR(255),
    nutrient_reference_amount VARCHAR(50),
    energy_kcal FLOAT, sodium_mg FLOAT, carbohydrate_g FLOAT, sugar_g FLOAT,
    fat_g FLOAT, trans_fat_g FLOAT, saturated_fat_g FLOAT, cholesterol_mg FLOAT,
    protein_g FLOAT, dietary_fiber_g FLOAT, potassium_mg FLOAT, phosphorus_mg FLOAT,
    ingredients TEXT,
    data_creation_date DATE,
    source_code INT,
    INDEX idx_food_name (food_name)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
"""

MYSQL_COLS = [
    "product_report_no", "food_name", "manufacturer",
    "main_category", "mid_category", "sub_category",
    "food_weight", "serving_size", "nutrient_reference_amount",
    "energy_kcal", "sodium_mg", "carbohydrate_g", "sugar_g", "fat_g",
    "trans_fat_g", "saturated_fat_g", "cholesterol_mg", "protein_g",
    "dietary_fiber_g", "potassium_mg", "phosphorus_mg",
    "ingredients", "data_creation_date", "source_code",
]


def load_mysql(limit=None, batch_size=1000):
    import mysql.connector

    conn = mysql.connector.connect(**MYSQL_CONFIG)
    cur = conn.cursor()
    cur.execute(MYSQL_DDL)
    sql = (
        f"INSERT INTO complete_data ({','.join(MYSQL_COLS)}) VALUES ({','.join(['%s'] * len(MYSQL_COLS))}) "
        "ON DUPLICATE KEY UPDATE " + ",".join(f"{c}=VALUES({c})" for c in MYSQL_COLS[1:])
    )
    batch, total = [], 0
    for row in read_rows(limit):
        cat = lambda k: (to_str(row.get(k)) if to_str(row.get(k)) != "해당없음" else None)
        batch.append((
            to_str(row["product_report_no"]), to_str(row["food_name"]), to_str(row.get("manufacturer")),
            cat("food_category_major"), cat("food_category_mid"), cat("food_category_minor"),
            to_str(row.get("food_weight")), to_str(row.get("serving_size")), to_str(row.get("nutrient_reference_amount")),
            *[to_float(row.get(c)) for c in MYSQL_COLS[9:21]],
            to_str(row.get("ingredients")), to_str(row.get("data_creation_date")),
            int(row["source_code"]) if (row.get("source_code") or "").strip().isdigit() else None,
        ))
        if len(batch) >= batch_size:
            cur.executemany(sql, batch)
            conn.commit()
            total += len(batch)
            batch.clear()
    if batch:
        cur.executemany(sql, batch)
        conn.commit()
        total += len(batch)
    cur.execute("SELECT COUNT(*) FROM complete_data")
    log.info("MySQL complete_data: 처리 %d건 / 테이블 총 %d건", total, cur.fetchone()[0])
    cur.close()
    conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--neo4j", action="store_true")
    ap.add_argument("--mysql", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    if not (a.neo4j or a.mysql):
        a.neo4j = a.mysql = True
    if a.mysql:
        load_mysql(a.limit)
    if a.neo4j:
        load_neo4j(a.limit)
