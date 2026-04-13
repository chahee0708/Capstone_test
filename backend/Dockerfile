#Node.js 18 버전 사용
FROM node:18

#백엔드 코드를 도커 컨테이너 안의 /app 폴더에 복사
WORKDIR /app

#pakage.json먼저 복사 후 라이브러리 설치
COPY package*.json ./

RUN npm install

#나머지 코드 복사
COPY . .

# 4000번 포트 열기
EXPOSE 4000

#서버실행 
CMD ["node","index.js"]

