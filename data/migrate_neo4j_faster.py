"""
complete_data (MySQL) → Neo4j 마이그레이션 (최종 최적화 및 초기화 버전)
"""

import logging
import re
import sys
import mysql.connector
from neo4j import GraphDatabase

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

MYSQL_CONFIG = {
    "host":     "localhost",
    "port":     3306,
    "user":     "root",
    "password": "password123",
    "database": "safebite_db",
    "charset":  "utf8mb4",
}

NEO4J_URI  = "bolt://localhost:7687"
NEO4J_AUTH = ("neo4j", "password123")

NUTRIENT_COLS = [
    ("sodium_mg",        "sodium",        "mg"),
    ("carbohydrate_g",   "carbohydrate",  "g"),
    ("sugar_g",          "sugar",         "g"),
    ("fat_g",            "fat",           "g"),
    ("trans_fat_g",      "trans_fat",     "g"),
    ("saturated_fat_g",  "saturated_fat", "g"),
    ("cholesterol_mg",   "cholesterol",   "mg"),
    ("protein_g",        "protein",       "g"),
]


def extract_number(s):
    if not s or str(s).strip() in ("", "nan", "None"):
        return None
    m = re.search(r'\d+\.?\d*', str(s))
    return float(m.group()) if m else None


def parse_ingredients(ing_str):
    if not ing_str or str(ing_str).strip() in ("", "nan", "None"):
        return []
    result = []
    depth = 0
    buf = []
    for ch in str(ing_str):
        if ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            name = "".join(buf).strip()
            if name:
                result.append(name)
            buf = []
        else:
            buf.append(ch)
    last = "".join(buf).strip()
    if last:
        result.append(last)
    return result


def migrate():
    # ── MySQL 데이터 로드 ─────────────────────────────────────
    log.info("MySQL 연결 중...")
    conn = mysql.connector.connect(**MYSQL_CONFIG)
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM complete_data")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    log.info(f"complete_data 로드: {len(rows)}건")

    # ── Neo4j 마이그레이션 ─────────────────────────────────────
    log.info("Neo4j 연결 중...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=NEO4J_AUTH)

    with driver.session() as s:
        # 🚀 [추가됨] 기존 데이터 완전 초기화
        log.info("기존 불완전한 데이터(노드 및 엣지) 삭제 중 (초기화)...")
        s.run("MATCH (n) DETACH DELETE n")
        log.info("초기화 완료!")

        log.info("제약조건 생성...")
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (f:FOOD)       REQUIRE f.product_report_no IS UNIQUE")
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (n:NUTRIENT)   REQUIRE n.nutrient_name     IS UNIQUE")
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (i:INGREDIENT) REQUIRE i.ingredient_name   IS UNIQUE")
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (c:CATEGORY)   REQUIRE c.category_name     IS UNIQUE")

        log.info("NUTRIENT 노드 생성...")
        for _, nutrient_name, unit in NUTRIENT_COLS:
            s.run(
                "MERGE (n:NUTRIENT {nutrient_name: $name}) SET n.nutrient_unit = $unit",
                name=nutrient_name, unit=unit,
            )

        # 🚀 [최적화] CATEGORY 노드 및 엣지 일괄 생성
        log.info("CATEGORY 노드 및 SUBCATEGORY_OF 생성...")

        def valid_cat(val):
            return val and str(val).strip() not in ("", "None", "nan", "해당없음")

        unique_categories = set()
        category_edges = set()

        for row in rows:
            main = row.get("main_category")
            mid  = row.get("mid_category")
            sub  = row.get("sub_category")

            if valid_cat(main): unique_categories.add(main)
            if valid_cat(mid): unique_categories.add(mid)
            if valid_cat(sub): unique_categories.add(sub)

            if valid_cat(sub) and valid_cat(mid):
                category_edges.add((sub, mid))
            if valid_cat(mid) and valid_cat(main):
                category_edges.add((mid, main))

        s.run("""
            UNWIND $batch AS r
            MERGE (:CATEGORY {category_name: r.name})
        """, batch=[{"name": c} for c in unique_categories])

        s.run("""
            UNWIND $batch AS r
            MATCH (child:CATEGORY {category_name: r.child})
            MATCH (parent:CATEGORY {category_name: r.parent})
            MERGE (child)-[:SUBCATEGORY_OF]->(parent)
        """, batch=[{"child": c, "parent": p} for c, p in category_edges])
        
        log.info(f"  → CATEGORY 노드 {len(unique_categories)}건, 엣지 {len(category_edges)}건 완료")

        # 🚀 [최적화] BATCH_SIZE 대폭 증가
        log.info("FOOD / INGREDIENT 노드 및 엣지 생성 (배치 처리)...")
        BATCH_SIZE = 5000

        # 1) FOOD 노드
        food_batch = [
            {
                "no":           str(row["product_report_no"]),
                "food_name":    row["food_name"],
                "manufacturer": row.get("manufacturer"),
                "food_weight":  extract_number(row.get("food_weight")),
                "serving_size": row.get("serving_size"),
                "nra":          extract_number(row.get("nutrient_reference_amount")),
                "energy_kcal":  float(row["energy_kcal"]) if row.get("energy_kcal") is not None else None,
            }
            for row in rows
        ]
        for i in range(0, len(food_batch), BATCH_SIZE):
            s.run("""
                UNWIND $batch AS r
                MERGE (f:FOOD {product_report_no: r.no})
                SET f.food_name                 = r.food_name,
                    f.manufacturer              = r.manufacturer,
                    f.food_weight               = r.food_weight,
                    f.serving_size              = r.serving_size,
                    f.nutrient_reference_amount = r.nra,
                    f.energy_kcal               = r.energy_kcal
            """, batch=food_batch[i:i + BATCH_SIZE])
        log.info(f"  → FOOD 노드 {len(food_batch)}건 완료")

        # 2) HAS_NUTRIENT 엣지
        nutrient_edges = []
        for row in rows:
            no = str(row["product_report_no"])
            for col, nutrient_name, _ in NUTRIENT_COLS:
                val = row.get(col)
                if val is not None:
                    nutrient_edges.append({"no": no, "name": nutrient_name, "amount": float(val)})

        for i in range(0, len(nutrient_edges), BATCH_SIZE):
            s.run("""
                UNWIND $batch AS r
                MATCH (f:FOOD     {product_report_no: r.no})
                MATCH (n:NUTRIENT {nutrient_name: r.name})
                MERGE (f)-[rel:HAS_NUTRIENT]->(n)
                SET rel.amount = r.amount
            """, batch=nutrient_edges[i:i + BATCH_SIZE])
        log.info(f"  → HAS_NUTRIENT 엣지 {len(nutrient_edges)}건 완료")

        # 3) BELONGS_TO 엣지
        belongs_edges = []
        for row in rows:
            sub  = row.get("sub_category")
            mid  = row.get("mid_category")
            belongs_cat = (
                sub if sub and str(sub).strip() not in ("", "None", "nan", "해당없음")
                else mid if mid and str(mid).strip() not in ("", "None", "nan", "해당없음")
                else None
            )
            if belongs_cat:
                belongs_edges.append({"no": str(row["product_report_no"]), "cat": belongs_cat})

        for i in range(0, len(belongs_edges), BATCH_SIZE):
            s.run("""
                UNWIND $batch AS r
                MATCH (f:FOOD     {product_report_no: r.no})
                MATCH (c:CATEGORY {category_name: r.cat})
                MERGE (f)-[:BELONGS_TO]->(c)
            """, batch=belongs_edges[i:i + BATCH_SIZE])
        log.info(f"  → BELONGS_TO 엣지 {len(belongs_edges)}건 완료")

        # 4) INGREDIENT 노드 + HAS_INGREDIENT 엣지
        ingredient_edges = []
        for row in rows:
            no = str(row["product_report_no"])
            for ing_name in parse_ingredients(row.get("ingredients", "")):
                ingredient_edges.append({"no": no, "name": ing_name})

        for i in range(0, len(ingredient_edges), BATCH_SIZE):
            s.run("""
                UNWIND $batch AS r
                MERGE (i:INGREDIENT {ingredient_name: r.name})
                ON CREATE SET i.ingredient_type = 'unknown'
                WITH i, r
                MATCH (f:FOOD {product_report_no: r.no})
                MERGE (f)-[:HAS_INGREDIENT]->(i)
            """, batch=ingredient_edges[i:i + BATCH_SIZE])
        log.info(f"  → HAS_INGREDIENT 엣지 {len(ingredient_edges)}건 완료")

        # ── 검증 ─────────────────────────────────────────────────
        log.info("─── 검증 결과 ───────────────────────────────────")
        checks = [
            ("FOOD 노드",           "MATCH (n:FOOD)       RETURN count(n) AS cnt"),
            ("NUTRIENT 노드",       "MATCH (n:NUTRIENT)   RETURN count(n) AS cnt"),
            ("INGREDIENT 노드",     "MATCH (n:INGREDIENT) RETURN count(n) AS cnt"),
            ("CATEGORY 노드",       "MATCH (n:CATEGORY)   RETURN count(n) AS cnt"),
            ("HAS_NUTRIENT 엣지",   "MATCH ()-[r:HAS_NUTRIENT]->()   RETURN count(r) AS cnt"),
            ("HAS_INGREDIENT 엣지", "MATCH ()-[r:HAS_INGREDIENT]->() RETURN count(r) AS cnt"),
            ("BELONGS_TO 엣지",     "MATCH ()-[r:BELONGS_TO]->()     RETURN count(r) AS cnt"),
            ("SUBCATEGORY_OF 엣지", "MATCH ()-[r:SUBCATEGORY_OF]->() RETURN count(r) AS cnt"),
        ]
        for label, query in checks:
            cnt = s.run(query).single()["cnt"]
            log.info(f"  {label}: {cnt}")

    driver.close()
    log.info("마이그레이션 완료!")


if __name__ == "__main__":
    migrate()