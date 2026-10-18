/**
 * app.js
 *
 * Express 앱 조립. 서버 실행(listen)은 index.js 가 담당하고,
 * 여기서는 의존성(db, neo4j, 판정 로직)을 주입받아 테스트 가능하게 만든다.
 */

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const multer = require("multer");

const config = require("./config");
const authMiddleware = require("./middleware/auth");
const createAuthRouter = require("./routes/auth");
const createUserRouter = require("./routes/user");
const createRecommendRouter = require("./routes/recommend");
const createOcrRouter = require("./routes/ocr");
const scoreService = require("./services/scoreService");
const createMlClient = require("./services/mlClient");

/**
 * @param {object} [deps]
 * @param {{ execute: Function }} [deps.db]
 * @param {() => object} [deps.getSession]
 * @param {Function} [deps.scoreForDiseaseUser]
 * @param {object} [deps.mlClient]   바코드/OCR 호출 클라이언트
 * @param {boolean} [deps.enableRateLimit]
 */
function createApp(deps = {}) {
  // 기본 의존성은 필요할 때만 로드한다 (테스트에서는 실제 DB 드라이버를 만들지 않도록)
  const db = deps.db || require("./db/mysql");
  const getSession = deps.getSession || require("./db/neo4j").getSession;
  const scoreForDiseaseUser = deps.scoreForDiseaseUser || scoreService.scoreForDiseaseUser;
  const mlClient = deps.mlClient || createMlClient();

  // 이미지 업로드: 메모리 보관(디스크에 남기지 않음), 이미지 형식만 허용
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.UPLOAD_MAX_BYTES, files: config.UPLOAD_MAX_FILES },
    fileFilter: (req, file, cb) => {
      if (/^image\//.test(file.mimetype)) return cb(null, true);
      const err = new Error("이미지 파일만 업로드할 수 있습니다.");
      err.code = "UNSUPPORTED_FILE_TYPE";
      cb(err);
    },
  });

  const app = express();

  app.disable("x-powered-by");
  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/", (req, res) => {
    res.json({ message: "백엔드 서버 정상 작동 중!" });
  });

  app.use(
    "/auth",
    createAuthRouter({ db, enableRateLimit: deps.enableRateLimit !== false })
  );
  app.use(
    "/recommend",
    authMiddleware,
    createRecommendRouter({
      db,
      getSession,
      scoreForDiseaseUser,
      MlServiceError: scoreService.MlServiceError,
      mlClient,
      upload,
      enableRateLimit: deps.enableRateLimit !== false,
    })
  );
  app.use(
    "/ocr",
    createOcrRouter({
      mlClient,
      upload,
      authMiddleware,
      enableRateLimit: deps.enableRateLimit !== false,
    })
  );
  app.use("/users", authMiddleware, createUserRouter({ db }));

  // 잘못된 JSON body 등 미들웨어 단계 오류를 JSON 으로 응답
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") {
      return res.status(400).json({ message: "요청 본문이 올바른 JSON이 아닙니다." });
    }
    if (err && err.type === "entity.too.large") {
      return res.status(413).json({ message: "요청 본문이 너무 큽니다." });
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "이미지 용량이 너무 큽니다. 더 작은 사진으로 시도해주세요." });
      }
      return res.status(400).json({ message: "이미지 업로드 형식이 올바르지 않습니다." });
    }
    if (err && err.code === "UNSUPPORTED_FILE_TYPE") {
      return res.status(400).json({ message: err.message });
    }
    console.error("처리되지 않은 오류:", err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  });

  return app;
}

module.exports = { createApp };
