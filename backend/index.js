// 환경변수 로드 (.env 파일 읽기)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const recommendRouter = require("./routes/recommend");
const userRouter = require("./routes/user");
const authRouter = require("./routes/auth");
const ocrRouter = require("./routes/ocr");
const authMiddleware = require("./middleware/auth");

const app = express();

// CORS 설정: credentials: true와 프론트 주소 허용
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "백엔드 서버 정상 작동 중!" });
});

app.use("/auth", authRouter);
app.use("/recommend", authMiddleware, recommendRouter);
app.use("/users", authMiddleware, userRouter);
app.use("/ocr", ocrRouter);

app.listen(4000, () => {
  console.log("백엔드 서버 실행 중: http://localhost:4000");
});