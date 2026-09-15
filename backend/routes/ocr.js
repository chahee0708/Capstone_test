const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});

const CLOVA_INVOKE_URL = "https://1unkz6kx73.apigw.ntruss.com/custom/v1/53790/bba3cb02c28788a28324152864c7928fc4d9c69c3815cc7919324ca2f81e7001/general";
const CLOVA_SECRET_KEY = "QUNqZXhDQnhuWENwRHRCRU9MaGd4c1ZIUk14bVlqYnQ=";

router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '이미지 파일이 전송되지 않았습니다.' });
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

    let fullText = "";
    if (result.images && result.images[0] && result.images[0].fields) {
      fullText = result.images[0].fields.map(f => f.inferText).join(' ');
    }

    console.log("[OCR Backend] 원본 텍스트:\n", fullText);

    // ── 1. 이름 ──
    let name = null;
    const nameMatch = fullText.match(/^([가-힣]{2,4})\s+[0-9]{6}/) ||
                      fullText.match(/^([가-힣]{2,4})\s+[0-9]{4}년/) ||
                      fullText.match(/(?:성\s*명|수검자명|수검자)\s*[:：]?\s*([가-힣]{2,4})/);
    if (nameMatch) name = nameMatch[1].trim();

    // ── 2. 주민번호 -> 나이 및 성별 ──
    let age = null;
    let gender = null;
    const rrnMatch = fullText.match(/([0-9]{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])\s*[-－]\s*([1-4])/);
    if (rrnMatch) {
      const birthYearPrefix = (rrnMatch[2] === '1' || rrnMatch[2] === '2') ? 1900 : 2000;
      const birthYear = birthYearPrefix + parseInt(rrnMatch[1], 10);
      age = new Date().getFullYear() - birthYear;
      gender = (rrnMatch[2] === '1' || rrnMatch[2] === '3') ? 'male' : 'female';
    }

    // ── 3. 혈압 먼저 추출 (키/몸무게 오인식 방지용) ──
    let sbp = null;
    let dbp = null;
    const bpMatch = fullText.match(/(?:고혈압|고위압|혈압)[^\d]{0,25}([0-9]{2,3})\s*[\/]\s*([0-9]{2,3})/i) ||
                    fullText.match(/([0-9]{2,3})\s*[\/]\s*([0-9]{2,3})\s*(?:mmHg|anHg)/i);
    if (bpMatch) {
      sbp = parseFloat(bpMatch[1]);
      dbp = parseFloat(bpMatch[2]);
    }

    // ── 4. 키 / 몸무게 (혈압 수치와 명확히 분리) ──
    let height = null;
    let weight = null;

    // "키 ... 몸무게" 키워드가 직접 동반된 경우에만 슬래시 파싱
    const hwMatch = fullText.match(/(?:키.*?몸무게|신장.*?체중)[\s\S]{0,40}?([0-9]{2,3}(?:\.[0-9])?)\s*[\/]\s*([0-9]{2,3}(?:\.[0-9])?)/i);
    if (hwMatch) {
      height = parseFloat(hwMatch[1]);
      weight = parseFloat(hwMatch[2]);
    } else {
      // 키/몸무게 행이 없거나 슬래시가 혈압 수치와 겹치지 않는 경우 단독 추출
      const hOnly = fullText.match(/(?:신장|키)\s*\(?cm\)?\s*[:：]?\s*(1[4-9][0-9](?:\.[0-9])?|20[0-9](?:\.[0-9])?)/i);
      if (hOnly) height = parseFloat(hOnly[1]);

      const wOnly = fullText.match(/(?<!저)체중\s*\(?kg\)?\s*[:：]?\s*([3-9][0-9](?:\.[0-9])?|1[0-9]{2}(?:\.[0-9])?)(?!\s*미만)/i);
      if (wOnly) weight = parseFloat(wOnly[1]);
    }

    // ── 5. 이상지질혈증 3대 수치 추출 (기준치 미만/이상 패턴 철저히 제외) ──
    let ldl = null;
    let hdl = null;
    let tg = null;

    if (!fullText.includes("비해당 비해당 비해당 비해당")) {
      // 1) 당뇨 뒤편에 밀려난 수치군: "유질환자 당뇨병 의심 253 58 이상지질혈증" -> HDL: 58
      const preLipidHdl = fullText.match(/의심\s+(?:[0-9]{2,3})\s+([3-9][0-9])\s+이상지질혈증/);
      if (preLipidHdl) {
        hdl = parseFloat(preLipidHdl[1]);
      }

      // 2) 이상지질 섹션 하단에 밀려난 수치군: "유질환자 136 168 혈액검사" -> TG: 136, LDL: 168
      const postLipidPair = fullText.match(/(?:유질환자|이상\s*의심)\s+([0-9]{2,3})\s+([0-9]{2,3})\s+(?:혈액검사|혈청|신장)/);
      if (postLipidPair) {
        tg = parseFloat(postLipidPair[1]);
        ldl = parseFloat(postLipidPair[2]);
      } else {
        // 일반 레이아웃 파싱
        if (!ldl) {
          const ldlMatch = fullText.match(/(?:저밀도|LDL)[^\d]{0,25}([0-9]{2,3})(?!\s*미만)/i);
          if (ldlMatch) ldl = parseFloat(ldlMatch[1]);
        }
        if (!tg) {
          const tgMatch = fullText.match(/(?:중성지방)[^\d]{0,40}?([0-9]{2,4})(?!\s*미만)/i);
          if (tgMatch) tg = parseFloat(tgMatch[1]);
        }
        if (!hdl) {
          const hdlMatch = fullText.match(/(?:고밀도|HDL|HI\.)[^\d]{0,25}([0-9]{2,3})(?!\s*이상)/i);
          if (hdlMatch) hdl = parseFloat(hdlMatch[1]);
        }
      }
    }

    // ── 6. 신장 수치 e-GFR (문미 108 수치 감지) ──
    let gfr = null;
    const gfrMatch = fullText.match(/(?:e-?GFR|신사구체여과[을율])[\s\S]{0,100}?([0-9]{2,3})(?!\.[0-9])(?:\s*$|\s+[가-힣A-Z])/i) ||
                     fullText.match(/신장기능\s*이상\s*의심\s*([0-9]{2,3})/i);
    if (gfrMatch) {
      gfr = parseFloat(gfrMatch[1]);
    }

    // ── 7. 지능형 질환 판정 ──
    const suggestedDiseases = [];

    // [고혈압]
    let hypertensionStage = 1;
    if ((sbp && sbp >= 140) || (dbp && dbp >= 90)) {
      suggestedDiseases.push("고혈압");
      hypertensionStage = (sbp >= 160 || dbp >= 100) ? 2 : 1;
    }

    // [당뇨병]
    const glucoseMatch = fullText.match(/공복혈당[^\d]{0,15}([0-9]{2,3})/);
    const fastingGlucose = glucoseMatch ? parseFloat(glucoseMatch[1]) : null;
    if ((fastingGlucose && fastingGlucose >= 126) || fullText.includes("■ 당뇨병 의심")) {
      suggestedDiseases.push("2형 당뇨");
    }

    // [이상지질혈증] (LDL 168은 130 이상으로 의심 판정)
    const isLipidAbnormal = (tg && tg >= 150) || (ldl && ldl >= 130) || (hdl && hdl < 40);
    const hasLipidChecked = fullText.includes("■ 고중성지방") || fullText.includes("■ 고콜레스테롤") || fullText.includes("■ 낮은 HDL");
    if (isLipidAbnormal || hasLipidChecked) {
      suggestedDiseases.push("이상지질혈증");
    }

    // [신장병]
    if (gfr && gfr < 60) {
      suggestedDiseases.push("신장병");
    }

    const extractedData = {
      name,
      age,
      gender,
      height,
      weight,
      sbp,
      dbp,
      fastingGlucose,
      ldl,
      hdl,
      tg,
      gfr,
      hypertensionStage,
      suggestedDiseases,
    };

    console.log("[OCR Backend] 정밀 보정 추출 결과:", extractedData);
    res.json({ success: true, fullText, extractedData });

  } catch (err) {
    console.error("[OCR Backend] 내부 에러:", err);
    res.status(500).json({ error: '서버 내부 OCR 처리 오류', message: err.message });
  }
});

module.exports = router;