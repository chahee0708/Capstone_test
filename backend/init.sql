-- users 테이블 생성
-- 질병 심각도 컬럼 설명:
--   hypertension_stage: 고혈압 단계 (1 = Stage I, 2 = Stage II)
--   ldl_level: 이상지질혈증 심각도 ('borderline', 'high', 'very_high')
--   gfr_value: 신장병 GFR 수치 (0 = 이식환자, 1~19 = 말기, 20~50 = 중기, 51이상 = 해당없음)

CREATE TABLE IF NOT EXISTS users (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  name               VARCHAR(50),
  age                INT,
  weight             FLOAT,
  height             FLOAT,
  gender             VARCHAR(10),
  diseases           JSON,
  allergens          JSON,

  -- 고혈압 심각도 (기본값: Stage I)
  hypertension_stage INT DEFAULT 1,

  -- 이상지질혈증 지질 수치 (mg/dL), 건강검진 실측값 저장
  ldl_value  FLOAT DEFAULT NULL,   -- LDL 콜레스테롤 수치
  tg_value   FLOAT DEFAULT NULL,   -- 중성지방 수치
  hdl_value  FLOAT DEFAULT NULL,   -- HDL 콜레스테롤 수치
  -- 신장병 GFR 수치 (기본값: 35 → GFR 20~50 범위 중간값)
  gfr_value          FLOAT DEFAULT 35
);

-- ──────────────────────────────────────────────────────────────────
-- 기존 테이블에 컬럼이 없으면 추가 (이미 컨테이너가 실행된 경우)
-- 처음 실행이면 위 CREATE TABLE로 이미 포함되어 있으므로 무시됨
-- ──────────────────────────────────────────────────────────────────
-- 테스트 데이터 (기존 유저)
-- 2형 당뇨 환자
INSERT INTO users (name, age, weight, height, gender, diseases, allergens)
VALUES ('홍길동', 45, 80, 170, 'male', '["2형 당뇨"]', '["우유"]');

-- 고혈압 Stage II 환자
INSERT INTO users (name, age, weight, height, gender, diseases, allergens, hypertension_stage)
VALUES ('이영희', 55, 70, 165, 'female', '["고혈압"]', '[]', 2);

-- 이상지질혈증 (LDL 높음) 환자
INSERT INTO users (name, age, weight, height, gender, diseases, allergens, ldl_value, tg_value, hdl_value)
VALUES ('박민수', 50, 85, 175, 'male', '["이상지질혈증"]', '[]', 165.0, 220.0, 38.0);

-- 신장병 (GFR 30) 환자
INSERT INTO users (name, age, weight, height, gender, diseases, allergens, gfr_value)
VALUES ('최지수', 60, 65, 160, 'female', '["신장병"]', '[]', 30);

-- 1형 당뇨 환자
INSERT INTO users (name, age, weight, height, gender, diseases, allergens)
VALUES ('김철수', 28, 65, 175, 'male', '["1형 당뇨"]', '[]');

-- 질병 없는 건강한 사용자
INSERT INTO users (name, age, weight, height, gender, diseases, allergens)
VALUES ('정하나', 30, 58, 163, 'female', '[]', '[]');