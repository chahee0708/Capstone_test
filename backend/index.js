// 서버 담당 파일
// 환경변수는 docker-compose.yml 에서 직접 주입한다 (dotenv 불필요).
// 앱 조립은 app.js, 여기서는 실행만 담당한다.

const config = require("./config");
const { createApp } = require("./app");

// 인증 시크릿 누락(운영 환경)은 서버 시작 단계에서 바로 드러나게 한다.
void config.JWT_SECRET;

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`백엔드 서버 실행 중: http://localhost:${config.PORT}`);
});
