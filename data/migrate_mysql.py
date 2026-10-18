"""
complete_data.csv → MySQL food 테이블 마이그레이션 스크립트
"""

import csv
import sys
import logging
import mysql.connector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger(__name__)

# 1. 파일명 수정
CSV_PATH = "complete_data.csv"

MYSQL_CONFIG = {
    "host":      "localhost",
    "port":      3306,
    "user":      "root",
    "password":  "password123",
    "database":  "safebite_db",
    "charset":   "utf8mb4",
}

BATCH_SIZE = 1000

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS complete_data (
    product_report_no VARCHAR(50) PRIMARY KEY,
    food_name VARCHAR(255) NOT NULL,
    manufacturer VARCHAR(255),
    main_category VARCHAR(100),
    mid_category VARCHAR(100),
    sub_category VARCHAR(100),
    food_weight VARCHAR(50),
    serving_size VARCHAR(100),
    nutrient_reference_amount VARCHAR(50),
    energy_kcal FLOAT,
    sodium_mg FLOAT,
    carbohydrate_g FLOAT,
    sugar_g FLOAT,
    fat_g FLOAT,
    trans_fat_g FLOAT,
    saturated_fat_g FLOAT,
    cholesterol_mg FLOAT,
    protein_g FLOAT,
    ingredients TEXT,
    data_creation_date DATE,
    source_code INT
);
"""

INSERT_SQL = """
INSERT INTO complete_data
  (product_report_no, food_name, manufacturer,
   main_category, mid_category, sub_category,
   food_weight, serving_size, nutrient_reference_amount,
   energy_kcal, sodium_mg, carbohydrate_g, sugar_g, fat_g,
   trans_fat_g, saturated_fat_g, cholesterol_mg, protein_g,
   ingredients, data_creation_date, source_code)
VALUES
  (%s, %s, %s,
   %s, %s, %s,
   %s, %s, %s,
   %s, %s, %s, %s, %s,
   %s, %s, %s, %s,
   %s, %s, %s)
ON DUPLICATE KEY UPDATE
  food_name                = VALUES(food_name),
  manufacturer             = VALUES(manufacturer),
  main_category            = VALUES(main_category),
  mid_category             = VALUES(mid_category),
  sub_category             = VALUES(sub_category),
  food_weight              = VALUES(food_weight),
  serving_size             = VALUES(serving_size),
  nutrient_reference_amount = VALUES(nutrient_reference_amount),
  energy_kcal              = VALUES(energy_kcal),
  sodium_mg                = VALUES(sodium_mg),
  carbohydrate_g           = VALUES(carbohydrate_g),
  sugar_g                  = VALUES(sugar_g),
  fat_g                    = VALUES(fat_g),
  trans_fat_g              = VALUES(trans_fat_g),
  saturated_fat_g          = VALUES(saturated_fat_g),
  cholesterol_mg           = VALUES(cholesterol_mg),
  protein_g                = VALUES(protein_g),
  ingredients              = VALUES(ingredients),
  data_creation_date       = VALUES(data_creation_date),
  source_code              = VALUES(source_code)
"""


def to_float(val):
    v = val.strip()
    if not v or v.lower() == "nan":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def to_none(val):
    v = val.strip()
    return None if (not v or v == "해당없음") else v


def to_date(val):
    v = val.strip()
    return v if v else None


def to_int(val):
    v = val.strip()
    if not v:
        return None
    try:
        return int(v)
    except ValueError:
        return None


def migrate():
    log.info("MySQL 연결 중...")
    conn = mysql.connector.connect(**MYSQL_CONFIG)
    cursor = conn.cursor()

    log.info("테이블 존재 여부 확인 및 생성 중...")
    cursor.execute(CREATE_TABLE_SQL)
    conn.commit()

    log.info(f"CSV 마이그레이션 시작: {CSV_PATH}")
    batch = []
    total = 0
    errors = 0

    with open(CSV_PATH, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        
        for i, row in enumerate(reader, 1):
            try:
                record = (
                    row["product_report_no"].strip(),
                    row["food_name"].strip(),
                    to_none(row["manufacturer"]),
                    # 2. 키 이름 오류 수정: 실제 CSV 컬럼명에 맞게 매핑
                    to_none(row["food_category_major"]),
                    to_none(row["food_category_mid"]),
                    to_none(row["food_category_minor"]),
                    to_none(row["food_weight"]),
                    to_none(row["serving_size"]),
                    to_none(row["nutrient_reference_amount"]),
                    to_float(row["energy_kcal"]),
                    to_float(row["sodium_mg"]),
                    to_float(row["carbohydrate_g"]),
                    to_float(row["sugar_g"]),
                    to_float(row["fat_g"]),
                    to_float(row["trans_fat_g"]),
                    to_float(row["saturated_fat_g"]),
                    to_float(row["cholesterol_mg"]),
                    to_float(row["protein_g"]),
                    to_none(row["ingredients"]),
                    to_date(row["data_creation_date"]),
                    to_int(row["source_code"]),
                )
                batch.append(record)
            except KeyError as e:
                log.warning(f"라인 {i+1}: 컬럼 누락 {e}, 스킵")
                errors += 1
                continue

            if len(batch) >= BATCH_SIZE:
                cursor.executemany(INSERT_SQL, batch)
                conn.commit()
                total += len(batch)
                log.info(f"  → {total:,}건 삽입")
                batch.clear()

    if batch:
        cursor.executemany(INSERT_SQL, batch)
        conn.commit()
        total += len(batch)

    cursor.close()
    conn.close()
    log.info(f"완료! 총 {total:,}건 삽입 / 오류 {errors}건")


if __name__ == "__main__":
    migrate()