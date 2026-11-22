/**
 * ocr.js
 *
 * 역할: 사진 글자 인식(CLOVA OCR General) 엔드포인트
 *   - POST /ocr       : 건강검진표 → 신체·검사 수치 추출
 *   - POST /ocr/label : 식품 라벨 → 제품명, 영양성분(100g당 환산), 원재료, 알레르기 문구 추출
 *
 * 이번 변경:
 *   - [추가] POST /ocr/label, callClovaGeneral (라벨 전용 CLOVA 호출)
 *   - 기존 POST /ocr 코드는 변경 없음. 같은 업로드 설정과 CLOVA 키를 쓴다
 *
 * 호출: index.js 의 app.use("/ocr", ocrRouter)
 *       → /ocr 는 프론트 ProfilePage.tsx, /ocr/label 은 분석 페이지 연결 전 (응답은 labelParser.js 참고)
 */

const path = require('path');
// 1. 현재 라우터 기준 상위 폴더(backend/.env 또는 프로젝트 루트 .env) 강제 로드
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config(); // 기본 경로 fallback

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');

// 프로젝트 내 authMiddleware 실제 경로에 맞게 확인
const authMiddleware = require('../middleware/auth');
const { parseLabel } = require('../services/labelParser');
const { parseCheckup } = require('../services/checkupParser'); // [추가] 건강검진표 값 찾기

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});

// 두 가지 환경변수 네이밍을 모두 지원하도록 안전 처리
const CLOVA_INVOKE_URL = process.env.CLOVA_INVOKE_URL || process.env.CLOVA_OCR_APIGW_URL;
const CLOVA_SECRET_KEY = process.env.CLOVA_SECRET_KEY || process.env.CLOVA_OCR_SECRET_KEY;

router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '이미지 파일이 전송되지 않았습니다.' });
    }

    if (!CLOVA_INVOKE_URL || !CLOVA_SECRET_KEY) {
      console.error('[OCR Backend] 환경변수(CLOVA_INVOKE_URL, CLOVA_SECRET_KEY) 누락');
      return res.status(500).json({ error: '서버 OCR 설정(환경변수)이 완료되지 않았습니다.' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    let format = 'jpg';
    if (['jpg', 'jpeg'].includes(ext)) format = 'jpg';
    else if (ext === 'png') format = 'png';
    else if (ext === 'pdf') format = 'pdf';
    else if (['tif', 'tiff'].includes(ext)) format = 'tiff';

    const formData = new FormData();
    const messageJson = {
      version: 'V2',
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      images: [{ format: format, name: 'health_checkup' }]
    };

    formData.append('message', JSON.stringify(messageJson));
    const fileBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'image/jpeg' });
    formData.append('file', fileBlob, req.file.originalname || `upload.${format}`);

    const response = await fetch(CLOVA_INVOKE_URL, {
      method: 'POST',
      headers: { 'X-OCR-SECRET': CLOVA_SECRET_KEY },
      body: formData
    });

    const result = await response.json();
    if (!response.ok) {
      const errMsg = result.message || (result.images && result.images[0]?.message) || '클로바 OCR API 호출 실패';
      return res.status(500).json({ error: `클로바 OCR 에러: ${errMsg}` });
    }

    const fields = (result.images && result.images[0] && result.images[0].fields) || [];
    const fullText = fields.map(f => f.inferText).join(' ');
    console.log("[OCR Backend] 원본 텍스트:\n", fullText);

    // [변경] 값 찾기는 services/checkupParser.js (좌표로 같은 줄의 값 + 예전 정규식, e-GFR 계산)
    const extractedData = parseCheckup(fields);
    console.log("[OCR Backend] 추출 결과:", extractedData);
    res.json({ success: true, fullText, extractedData });

  } catch (err) {
    console.error("[OCR Backend] 내부 에러:", err);
    res.status(500).json({ error: '서버 내부 OCR 처리 오류', message: err.message });
  }
});

// [추가] 업로드 파일을 CLOVA General 형식으로 보내고 글자 조각(fields)을 돌려준다 (실패 시 예외)
async function callClovaGeneral(file, imageName) {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  let format = 'jpg';
  if (ext === 'png') format = 'png';
  else if (ext === 'pdf') format = 'pdf';
  else if (['tif', 'tiff'].includes(ext)) format = 'tiff';

  const formData = new FormData();
  formData.append('message', JSON.stringify({
    version: 'V2',
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
    images: [{ format, name: imageName }]
  }));
  const fileBlob = new Blob([file.buffer], { type: file.mimetype || 'image/jpeg' });
  formData.append('file', fileBlob, file.originalname || `upload.${format}`);

  const response = await fetch(CLOVA_INVOKE_URL, {
    method: 'POST',
    headers: { 'X-OCR-SECRET': CLOVA_SECRET_KEY },
    body: formData
  });

  const result = await response.json();
  const image = result.images && result.images[0];
  // HTTP 200 이어도 이미지별 인식이 실패할 수 있어 inferResult 까지 확인한다
  if (!response.ok || !image || image.inferResult !== 'SUCCESS') {
    throw new Error(result.message || image?.message || '클로바 OCR API 호출 실패');
  }
  return image.fields ?? [];
}

// [추가] POST /ocr/label: 식품 라벨 사진 분석 (입력 형식과 인증은 POST /ocr 와 같다)
router.post('/label', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '이미지 파일이 전송되지 않았습니다.' });
    }

    if (!CLOVA_INVOKE_URL || !CLOVA_SECRET_KEY) {
      console.error('[OCR Label] 환경변수(CLOVA_INVOKE_URL, CLOVA_SECRET_KEY) 누락');
      return res.status(500).json({ error: '서버 OCR 설정(환경변수)이 완료되지 않았습니다.' });
    }

    const fields = await callClovaGeneral(req.file, 'food_label');
    const parsed = parseLabel(fields);

    // [추가] 진단용 로그: 휴대폰 사진이 잘 안 읽힐 때 원인을 보려고 (사진 정보, 읽은 글자 수, 찾은 값, 경고)
    const found = Object.values(parsed.nutritionPer100g || {}).filter((v) => v !== null && v !== undefined).length;
    console.log(
      `[OCR Label] 파일=${req.file.originalname} ${req.file.mimetype} ${Math.round(req.file.size / 1024)}KB` +
        ` | 글자조각=${fields.length} | 제품명=${parsed.productName ?? '-'} | 기준량=${JSON.stringify(parsed.basis ?? null)}` +
        ` | 영양성분 ${found}/9 | 원재료 ${parsed.ingredients?.length ?? 0}개 | 경고=${JSON.stringify(parsed.warnings ?? [])}`,
    );
    console.log(`[OCR Label] 읽은 글자(앞부분): ${(parsed.rawText || '').slice(0, 400)}`);

    res.json(parsed);
  } catch (err) {
    console.error('[OCR Label] 처리 실패:', err);
    res.status(500).json({ error: '라벨 OCR 처리 오류', message: err.message });
  }
});

module.exports = router;