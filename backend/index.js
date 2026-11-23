// 환경변수 로드 (.env 파일 읽기)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const recommendRouter = require("./routes/recommend");
const userRouter = require("./routes/user");
const authRouter = require("./routes/auth");
const ocrRouter = require("./routes/ocr");
const authMiddleware = require("./middleware/auth");
// [추가] 관심 식품 / 최근 검색 (프로필 "내 식품" 탭)
const { router: myFoodsRouter, ensureMyFoodTables } = require("./routes/myFoods");
// [추가] 2형 당뇨 ML 입력(식이섬유·인·칼륨) 중분류 평균을 미리 계산 (실패하면 첫 분석 때 다시)
const { loadAverages } = require("./services/mlFeatures");

const app = express();

// CORS 설정: credentials: true와 프론트 주소 허용
app.use(
  cors({
    // [변경] CORS_ORIGIN 으로 덮어쓸 수 있게 (기본값은 그대로)
    //   쉼표로 여러 개 가능: "http://localhost:5174,http://192.168.0.5:5174" (핸드폰 시연용 PC 주소)
    origin: (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((o) => o.trim()),
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
app.use("/me", authMiddleware, myFoodsRouter);

app.listen(4000, () => {
  console.log("백엔드 서버 실행 중: http://localhost:4000");
  // 관심 식품·최근 검색 테이블이 없으면 만든다 (실패하면 첫 요청 때 다시 시도)
  ensureMyFoodTables()
    .then(() => console.log("[내 식품] 테이블 확인 완료"))
    .catch((err) => console.error("[내 식품] 테이블 만들기 실패:", err.message));
  // [추가] 컨테이너가 함께 켜질 때는 Neo4j 가 늦게 준비된다 → 5초마다 최대 12번 다시 시도
  //        끝내 실패해도 첫 분석 때 다시 계산하므로 로그만 남긴다
  const preloadAverages = (triesLeft) =>
    loadAverages().catch((err) => {
      if (triesLeft > 1) setTimeout(() => preloadAverages(triesLeft - 1), 5000);
      else console.error("[ML 입력] 평균 미리 계산 실패 (첫 분석 때 다시):", err.message);
    });
  preloadAverages(12);
});