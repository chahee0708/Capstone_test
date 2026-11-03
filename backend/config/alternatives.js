/**
 * alternatives.js
 *
 * 역할: 대체음식 추천 설정값
 *
 * 이번에 바뀐 점: SIM_THRESHOLD 기본값 0.70 → 0.75 (근거는 아래 주석)
 *
 * 호출: backend/services/alternativeService.js
 */

// 원재료 유사도 기준값 (이 값 미만인 후보는 대체음식에서 제외)
// [변경] 기본값 0.70 → 0.75
//   정답 240쌍 기준 Precision 0.70=0.86, 0.75=0.97.
//   가상 사용자 평가(5명×1,010개) 평균 제공률 0.70=26.6%, 0.75=20.1%.
//   건강 서비스 특성상 잘못된 추천을 줄이는 정확도 우선 원칙으로 0.75 선택
//   (평가 스크립트: backend/scripts/evalAlternatives.js)
// 환경변수 ALT_SIM_THRESHOLD 로 덮어쓸 수 있다 (예: ALT_SIM_THRESHOLD=0.7)
const envThreshold = parseFloat(process.env.ALT_SIM_THRESHOLD);
const SIM_THRESHOLD = Number.isFinite(envThreshold) ? envThreshold : 0.75;

// 응답에 담을 대체음식 최대 개수
const MAX_ALTERNATIVES = 3;

module.exports = { SIM_THRESHOLD, MAX_ALTERNATIVES };
