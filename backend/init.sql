-- users 테이블 생성
-- 질병 심각도 컬럼 설명:
--   hypertension_stage: 고혈압 단계 (1 = Stage I, 2 = Stage II)
--   ldl_level: 이상지질혈증 심각도 ('borderline', 'high', 'very_high')
--   gfr_value: 신장병 GFR 수치 (0 = 이식환자, 1~19 = 말기, 20~50 = 중기, 51이상 = 해당없음)

CREATE TABLE IF NOT EXISTS users (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  name               VARCHAR(50),
  email              VARCHAR(255) UNIQUE,
  password           VARCHAR(255),
  age                INT,
  weight             FLOAT,
  height             FLOAT,
  gender             VARCHAR(10),
  diseases           JSON,
  allergens          JSON,

  -- 고혈압 심각도 (기본값: Stage I)
  hypertension_stage INT DEFAULT 1,

  -- 이상지질혈증 지질 수치 (mg/dL)
  ldl_value          FLOAT DEFAULT NULL,
  tg_value           FLOAT DEFAULT NULL,
  hdl_value          FLOAT DEFAULT NULL,

  -- 신장병 GFR 수치 (기본값: 35 → GFR 20~50 범위 중간값)
  gfr_value          FLOAT DEFAULT 35
);

-- 테스트 데이터 (기존 유저)
-- bcrypt hash for "password123": $2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhmW

-- 2형 당뇨 환자
INSERT INTO users (name, email, password, age, weight, height, gender, diseases, allergens)
VALUES ('홍길동', 'user1@test.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhmW', 45, 80, 170, 'male', '["2형 당뇨"]', '["우유"]');

-- 고혈압 Stage II 환자
INSERT INTO users (name, email, password, age, weight, height, gender, diseases, allergens, hypertension_stage)
VALUES ('이영희', 'user2@test.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhmW', 55, 70, 165, 'female', '["고혈압"]', '[]', 2);

-- 이상지질혈증 환자 (LDL 높음, TG 높음, HDL 낮음)
INSERT INTO users (name, email, password, age, weight, height, gender, diseases, allergens, ldl_value, tg_value, hdl_value)
VALUES ('박민수', 'user3@test.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhmW', 50, 85, 175, 'male', '["이상지질혈증"]', '[]', 165.0, 220.0, 38.0);

-- 신장병 (GFR 30) 환자
INSERT INTO users (name, email, password, age, weight, height, gender, diseases, allergens, gfr_value)
VALUES ('최지수', 'user4@test.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhmW', 60, 65, 160, 'female', '["신장병"]', '[]', 30);

-- 1형 당뇨 환자
INSERT INTO users (name, email, password, age, weight, height, gender, diseases, allergens)
VALUES ('김철수', 'user5@test.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhmW', 28, 65, 175, 'male', '["1형 당뇨"]', '[]');

-- 질병 없는 건강한 사용자
INSERT INTO users (name, email, password, age, weight, height, gender, diseases, allergens)
VALUES ('정하나', 'user6@test.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhmW', 30, 58, 163, 'female', '[]', '[]');