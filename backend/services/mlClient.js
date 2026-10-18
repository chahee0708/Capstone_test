/**
 * mlClient.js
 *
 * ML 서비스(FastAPI)의 바코드/OCR 엔드포인트 호출 클라이언트.
 *   - 연결 실패/타임아웃/5xx  → MlServiceError  (라우터가 503 으로 변환)
 *   - 4xx(잘못된 이미지 등)    → MlRequestError  (라우터가 400 으로 변환)
 *
 * 이미지 파일은 multipart/form-data 로 전달한다 (Node 18+ 전역 FormData/Blob 사용).
 * fetchImpl 은 테스트에서 주입한다.
 */

const config = require("../config");
const { MlServiceError, MlRequestError } = require("./errors");

function createMlClient({ fetchImpl = fetch, baseUrl = config.ML_SERVICE_URL } = {}) {
  async function request(path, init, timeoutMs) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new MlServiceError("ML 서비스에 연결할 수 없습니다.", err);
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      /* 본문이 JSON 이 아님 */
    }

    if (res.status >= 500) {
      throw new MlServiceError(`ML 서비스 오류 응답 (${res.status})`);
    }
    if (!res.ok) {
      const detail = body && (body.detail || body.message);
      throw new MlRequestError(
        typeof detail === "string" ? detail : "요청을 처리할 수 없습니다.",
        res.status === 413 ? 413 : 400
      );
    }
    if (body === null) {
      throw new MlServiceError("ML 서비스 응답을 해석할 수 없습니다.");
    }
    return body;
  }

  function formWith(field, files) {
    const form = new FormData();
    for (const f of files) {
      form.append(field, new Blob([f.buffer], { type: f.mimetype || "application/octet-stream" }), f.originalname || "image");
    }
    return form;
  }

  return {
    /** 바코드 번호 → 품목보고번호/제품 정보 */
    barcodeLookup(code) {
      return request(`/barcode/lookup?code=${encodeURIComponent(code)}`, { method: "GET" }, config.ML_TIMEOUT_MS);
    },

    /** 바코드 이미지 → 번호 디코딩 + 조회 */
    barcodeDecode(file) {
      return request("/barcode/decode", { method: "POST", body: formWith("file", [file]) }, config.ML_OCR_TIMEOUT_MS);
    },

    /** 영양성분표/원재료명 이미지(최대 4장) → 구조화 결과 */
    ocrLabel(files) {
      return request("/ocr/label", { method: "POST", body: formWith("files", files) }, config.ML_OCR_TIMEOUT_MS);
    },

    /** 건강검진 결과지 이미지 → 프로필 항목 */
    ocrCheckup(file) {
      return request("/ocr/checkup", { method: "POST", body: formWith("file", [file]) }, config.ML_OCR_TIMEOUT_MS);
    },
  };
}

module.exports = createMlClient;
module.exports.createMlClient = createMlClient;
