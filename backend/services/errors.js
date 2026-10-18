/**
 * errors.js — 서비스 계층 공용 오류 클래스
 */

/** ML 서비스(예측/OCR/바코드) 연결·응답 오류. 라우터가 503 으로 변환한다. */
class MlServiceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "MlServiceError";
    this.cause = cause;
  }
}

/** ML 서비스가 요청 자체를 거부한 경우(잘못된 이미지 등). 라우터가 4xx 로 변환한다. */
class MlRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "MlRequestError";
    this.status = status;
  }
}

module.exports = { MlServiceError, MlRequestError };
