// 서버 담당 파일
// docker-compose.yml에서 환경변수를 이미 직접 넣어주고 있어서 
// dotenv 자체가 필요없음. 일단 주석 처리
// require("dotenv").config();

const express = require("express");
const cors = require("cors");
const recommendRouter = require("./routes/recommend");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "백엔드 서버 정상 작동 중!" });
});

app.use("/recommend", recommendRouter);

app.listen(4000, () => {
  console.log("백엔드 서버 실행 중: http://localhost:4000");
});
