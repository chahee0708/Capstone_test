# Python 3.10 기반 ML 서비스 컨테이너
# - predict_service.py (FastAPI) 실행
# - 포트 8000으로 /predict 엔드포인트 제공
FROM python:3.10

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "predict_service:app", "--host", "0.0.0.0", "--port", "8000"]