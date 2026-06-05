// 서버 담당 파일
// docker-compose.yml에서 환경변수를 이미 직접 넣어주고 있어서
// dotenv 자체가 필요없음. 일단 주석 처리
// require("dotenv").config();

const express = require("express");
const cors = require("cors");
const recommendRouter = require("./routes/recommend");
const userRouter = require("./routes/user");
const authRouter = require("./routes/auth");
const historyRouter = require("./routes/history");
const authMiddleware = require("./middleware/auth");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "백엔드 서버 정상 작동 중!" });
});

app.use("/auth", authRouter);
app.use("/recommend", authMiddleware, recommendRouter);
app.use("/users", authMiddleware, userRouter);
app.use("/history", authMiddleware, historyRouter);

app.listen(4000, () => {
  console.log("백엔드 서버 실행 중: http://localhost:4000");
});
