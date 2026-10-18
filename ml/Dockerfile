# Python 3.12 기반 ML 서비스 컨테이너
# - predict_service.py (FastAPI) 실행, 포트 8000
#   POST /predict (2형 당뇨 GI 예측), /ocr/*, /barcode/*
FROM python:3.12-slim

WORKDIR /app

# libzbar0: pyzbar(바코드 디코딩), libgl1/libglib2.0-0: OpenCV 런타임
RUN apt-get update \
    && apt-get install -y --no-install-recommends libzbar0 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# OCR 모델을 이미지에 포함시킨다 (실행 시 다운로드/네트워크 의존 제거)
RUN python -c "import ocr_engine; ocr_engine.warmup()"

# 바코드 모듈(B 폴더)은 docker-compose 에서 /app/B 로 마운트한다 (BARCODE_MODULE_DIR)
ENV BARCODE_MODULE_DIR=/app/B

EXPOSE 8000

CMD ["uvicorn", "predict_service:app", "--host", "0.0.0.0", "--port", "8000"]
