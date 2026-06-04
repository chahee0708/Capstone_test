# Node.js 18 버전 사용
FROM node:20
 
WORKDIR /app
 
# 라이브러리 먼저 설치
COPY package*.json ./
RUN npm install
 
# 나머지 코드 복사
COPY . .
 
# 3000번 포트 열기
EXPOSE 3000
 
# React 개발 서버 실행
CMD ["npm", "run", "dev", "--", "--host"]
 