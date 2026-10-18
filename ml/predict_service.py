"""
predict_service.py
- 역할: SafeBite ML 서비스 (FastAPI)
    POST /predict           음식 영양소 11개 → GI Category(Low/Medium/High)  [2형 당뇨 판정]
    GET  /barcode/lookup    바코드 번호 → 품목보고번호/제품 정보              [B 모듈 연결]
    POST /barcode/decode    바코드 사진 → 번호 디코딩 + 제품 조회
    POST /ocr/label         식품 라벨 사진(1~4장) → 영양성분/원재료명/알레르기 문구
    POST /ocr/checkup       건강검진 결과지 사진 → 신체/혈액 수치
    GET  /health            상태 확인
- 모델: output/diabetes_model.pkl (train_model.py 로 학습한 RandomForest)
- 호출자: backend (Node.js 가 HTTP 로 이 서비스를 호출)
"""

from __future__ import annotations

import pickle
from pathlib import Path
from typing import List

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

import barcode_service
import ocr_engine
import ocr_pipeline

BASE_DIR = Path(__file__).resolve().parent
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 이미지 1장 최대 15MB (백엔드가 먼저 제한한다)
MAX_LABEL_IMAGES = 4

app = FastAPI(title="SafeBite ML")

# ─────────────────────────────────────────────────────────────
# 2형 당뇨 GI 예측 모델
# ─────────────────────────────────────────────────────────────
# 학습 때 저장한 모델 + 스케일러 + 피처 순서 로드
# train_model.py에서 pickle.dump()로 저장한 딕셔너리
with open(BASE_DIR / "output" / "diabetes_model.pkl", "rb") as f:
    saved = pickle.load(f)

model = saved["model"]  # RandomForest 모델
scaler = saved["scaler"]  # StandardScaler (학습 때와 동일한 스케일 적용)
feature_cols = saved["feature_cols"]  # 피처 순서 확인용


# 입력 데이터 형식 정의
# train_model.py의 feature_cols 순서와 반드시 동일해야 함
class NutritionInput(BaseModel):
    calories: float  # Calories (kcal)
    protein: float  # Protein (g)
    fats: float  # Fats (g)
    carbs: float  # Carbs (g)
    fiber: float  # Fiber (g)
    sugar: float  # Sugar (g)
    phosphorus: float  # Phosphorus (mg)
    potassium: float  # Potassium (mg)
    sodium: float  # Sodium (mg)
    saturated_fat: float  # Saturated Fat (g)
    trans_fat: float  # Trans Fat (g)


# 모델 출력(숫자) → 문자열 변환
LABEL_MAP = {0: "Low", 1: "Medium", 2: "High"}


@app.post("/predict")
def predict(data: NutritionInput):
    # train_model.py의 feature_cols 순서 그대로 배열 구성
    features = np.array([[
        data.calories, data.protein, data.fats, data.carbs,
        data.fiber, data.sugar, data.phosphorus, data.potassium,
        data.sodium, data.saturated_fat, data.trans_fat,
    ]])

    # 학습 때와 동일한 스케일러로 변환 후 예측
    scaled = scaler.transform(features)
    prediction = model.predict(scaled)[0]

    return {"gi_category": LABEL_MAP[prediction]}


# ─────────────────────────────────────────────────────────────
# 업로드 헬퍼
# ─────────────────────────────────────────────────────────────
def _read_upload(f: UploadFile) -> bytes:
    data = f.file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="이미지 용량이 너무 큽니다.")
    return data


# ─────────────────────────────────────────────────────────────
# 바코드 (B 모듈)
# ─────────────────────────────────────────────────────────────
@app.get("/barcode/lookup")
def barcode_lookup(code: str = Query(..., min_length=6, max_length=20)):
    svc = barcode_service.get_service()
    result = svc.lookup(code)
    if result["status"] == "unavailable":
        raise HTTPException(status_code=503, detail=result.get("message") or "바코드 매핑을 사용할 수 없습니다.")
    return result


@app.post("/barcode/decode")
def barcode_decode(file: UploadFile = File(...)):
    data = _read_upload(file)
    svc = barcode_service.get_service()
    if not svc.ready:
        raise HTTPException(status_code=503, detail=svc.error or "바코드 매핑을 사용할 수 없습니다.")
    try:
        return svc.decode_image(data)
    except ocr_engine.ImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ─────────────────────────────────────────────────────────────
# OCR
# ─────────────────────────────────────────────────────────────
@app.post("/ocr/label")
def ocr_label(files: List[UploadFile] = File(...)):
    if len(files) > MAX_LABEL_IMAGES:
        raise HTTPException(status_code=400, detail=f"이미지는 최대 {MAX_LABEL_IMAGES}장까지 분석할 수 있습니다.")
    blobs = [_read_upload(f) for f in files]
    try:
        return ocr_pipeline.analyze_label_images(blobs)
    except ocr_engine.ImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ocr_engine.OcrEngineError as exc:
        raise HTTPException(status_code=500, detail=f"{exc} 사진 크기를 줄여 다시 시도해 주세요.")


@app.post("/ocr/checkup")
def ocr_checkup(file: UploadFile = File(...)):
    blob = _read_upload(file)
    try:
        return ocr_pipeline.analyze_checkup_image(blob)
    except ocr_engine.ImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ocr_engine.OcrEngineError as exc:
        raise HTTPException(status_code=500, detail=f"{exc} 사진 크기를 줄여 다시 시도해 주세요.")


# ─────────────────────────────────────────────────────────────
# 상태 확인
# ─────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "ok": True,
        "model": True,
        "barcode": barcode_service.get_service().info(),
    }


@app.on_event("startup")
def _warmup() -> None:
    """OCR 모델을 서비스 시작 시 미리 로드해 첫 요청 지연을 줄인다. (실패해도 서비스는 시작)"""
    try:
        ocr_engine.warmup()
        barcode_service.get_service().info()
    except Exception as exc:  # noqa: BLE001
        print(f"[ml] OCR/바코드 워밍업 실패: {exc}")
