/**
 * alternatives.js
 *
 * 역할: 대체음식 추천 설정값
 *
 * 이번에 바뀐 점: 새 파일
 *
 * 호출: backend/services/alternativeService.js
 */

// 원재료 유사도 기준값 (이 값 미만인 후보는 대체음식에서 제외)
// 기준값 후보 0.70 / 0.75. 정답 데이터 240쌍 분석 결과 Precision 0.86 / 0.97.
// 등급 필터 후 대체음식 제공률을 비교해 최종 결정 예정
// 환경변수 ALT_SIM_THRESHOLD 로 덮어쓸 수 있다 (예: ALT_SIM_THRESHOLD=0.75)
const envThreshold = parseFloat(process.env.ALT_SIM_THRESHOLD);
const SIM_THRESHOLD = Number.isFinite(envThreshold) ? envThreshold : 0.7;

// 응답에 담을 대체음식 최대 개수
const MAX_ALTERNATIVES = 3;

module.exports = { SIM_THRESHOLD, MAX_ALTERNATIVES };
