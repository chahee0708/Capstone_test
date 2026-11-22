/**
 * per100.ts
 *
 * 역할: 라벨에 적힌 값을 100g당 값으로 바꾼다 (값 × 100 ÷ 기준량, 소수 둘째 자리 사사오입)
 *       backend/services/labelParser.js 의 toPer100 과 같은 정수 계산식이다.
 *       프론트 이미지는 ./frontend 만으로 빌드되어 백엔드 파일을 가져올 수 없으므로 같은 식을 옮겨 왔다.
 *       (두 함수 중 하나를 바꾸면 다른 쪽도 같이 바꿀 것)
 *
 * 이번 변경: 새 파일
 *
 * 호출: frontend/src/app/pages/FoodAnalysisPage.tsx (OCR 확인 화면)
 */

/** 기준량으로 쓸 수 있는 값인지 (정수 계산에서 0 으로 나누지 않도록 0.001 이상) */
export function isValidBasis(amount: number): boolean {
  return Number.isFinite(amount) && Math.round(amount * 1000) > 0;
}

/**
 * 값 × 100 ÷ 기준량, 소수 둘째 자리 사사오입. 소수 오차가 없도록 정수로 계산한다
 * ml 기준량도 1ml = 1g 으로 같은 식을 쓴다 (팀 규칙)
 */
export function toPer100(value: number, amount: number): number {
  const scaledValue = BigInt(Math.round(value * 1000));
  const scaledAmount = BigInt(Math.round(amount * 1000));
  const numerator = scaledValue * 100n * 100n;
  const rounded = (2n * numerator + scaledAmount) / (2n * scaledAmount);
  return Number(rounded) / 100;
}
