# 프론트엔드 컨테이너 (Node 20)
#
# [변경] 개발 서버(npm run dev) 대신 빌드한 파일을 vite preview 로 서비스한다
#   - 개발 서버는 페이지 하나에 파일 150여 개(약 5MB)를 받아 터널·휴대폰에서 느리고,
#     실시간 연결(HMR)이 끊겼다 다시 붙으면 페이지를 새로고침해 분석 결과가 사라졌다
#     (휴대폰 화면이 꺼지거나 OCR 사진을 찍으러 카메라 앱에 다녀올 때)
#   - VITE_API_URL 은 빌드할 때 화면 코드에 들어간다 → 이미지 만들 때가 아니라 컨테이너가 켜질 때 빌드한다
#     (start-demo.ps1 이 터널 주소를 docker-compose.override.yml 에 넣고 컨테이너를 다시 띄우면 그 주소로 빌드됨)
#   - 켜질 때 빌드에 10초 안팎 걸린다. 소스를 고치면 이미지도 다시 만들어야 한다: docker compose up -d --build frontend
#   - 포트는 예전과 같은 5173 (compose 포트 연결 그대로). __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS 도 preview 에 그대로 적용된다
FROM node:20

WORKDIR /app

# 라이브러리 먼저 설치
COPY package*.json ./
RUN npm install

# 나머지 코드 복사
COPY . .

EXPOSE 5173

# 빌드 → 빌드한 파일 서비스 (새로고침해도 /analysis 등은 index.html 로 연결된다)
CMD ["sh", "-c", "npm run build && exec npx vite preview --host 0.0.0.0 --port 5173 --strictPort"]
