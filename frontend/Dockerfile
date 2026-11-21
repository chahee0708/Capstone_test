# Node.js 20
FROM node:20

WORKDIR /app

# 라이브러리 먼저 설치
COPY package*.json ./
RUN npm install

# 나머지 코드 복사
COPY . .

# [변경] 배포용 빌드: 이미지를 만들 때 한 번 빌드해 두고, 실행할 때는 완성된 파일(dist)만 보낸다
#   - 개발 서버(npm run dev)보다 휴대폰에서 첫 화면이 훨씬 빨리 뜬다 (파일 수백 개 → 몇 개)
#   - /api 를 백엔드로 넘기는 규칙과 터널 주소 허용은 vite.config.ts 의 preview 설정을 그대로 쓴다
#   - 코드를 고치면 docker compose up -d --build frontend 로 다시 빌드해야 반영된다
RUN npm run build

EXPOSE 5173

# 빌드 결과 미리보기 서버 (5173 포트, 바깥에서 접속 가능)
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
