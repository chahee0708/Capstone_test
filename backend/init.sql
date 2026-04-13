CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50),
  age INT,
  weight FLOAT,
  height FLOAT,
  gender VARCHAR(10),
  diseases JSON,     -- 예: ["2형 당뇨", "고혈압"]
  allergens JSON     -- 예: ["우유", "땅콩"]
);

-- 질병 있는 사용자
INSERT INTO users (name, age, weight, height, gender, diseases, allergens)
VALUES ('홍길동', 45, 80, 170, 'male', '["2형 당뇨"]', '["우유"]');

-- 질병 없는 사용자
INSERT INTO users (name, age, weight, height, gender, diseases, allergens)
VALUES ('김철수', 28, 65, 175, 'male', '[]', '[]');