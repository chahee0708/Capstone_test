"""
predict_service.py
- 역할: 음식 영양소 11개를 받아 GI Category(Low/Medium/High)를 반환하는 ML 예측 API
- 프레임워크: FastAPI
- 모델: output/diabetes_model.pkl (train_model.py로 학습한 RandomForest)
- 호출자: backend/services/scoreService.js (Node.js가 HTTP로 이 서비스를 호출)
"""

from fastapi import FastAPI
from pydantic import BaseModel
import pickle
import numpy as np

app = FastAPI()

# 학습 때 저장한 모델 + 스케일러 + 피처 순서 로드
# train_model.py에서 pickle.dump()로 저장한 딕셔너리
with open("output/diabetes_model.pkl", "rb") as f:
    saved = pickle.load(f)

model = saved['model']           # RandomForest 모델
scaler = saved['scaler']         # StandardScaler (학습 때와 동일한 스케일 적용)
feature_cols = saved['feature_cols']  # 피처 순서 확인용

# 입력 데이터 형식 정의
# train_model.py의 feature_cols 순서와 반드시 동일해야 함
class NutritionInput(BaseModel):
    calories: float      # Calories (kcal)
    protein: float       # Protein (g)
    fats: float          # Fats (g)
    carbs: float         # Carbs (g)
    fiber: float         # Fiber (g)
    sugar: float         # Sugar (g)
    phosphorus: float    # Phosphorus (mg)
    potassium: float     # Potassium (mg)
    sodium: float        # Sodium (mg)
    saturated_fat: float # Saturated Fat (g)
    trans_fat: float     # Trans Fat (g)

# 모델 출력(숫자) → 문자열 변환
LABEL_MAP = {0: "Low", 1: "Medium", 2: "High"}

@app.post("/predict")
def predict(data: NutritionInput):
    # train_model.py의 feature_cols 순서 그대로 배열 구성
    features = np.array([[
        data.calories, data.protein, data.fats, data.carbs,
        data.fiber, data.sugar, data.phosphorus, data.potassium,
        data.sodium, data.saturated_fat, data.trans_fat
    ]])

    # 학습 때와 동일한 스케일러로 변환 후 예측
    scaled = scaler.transform(features)
    prediction = model.predict(scaled)[0]

    return {"gi_category": LABEL_MAP[prediction]}