/**
 * barcodeUtil.js — 바코드 번호 정규화/검증 (EAN-8, UPC-A, EAN-13, GTIN-14)
 */

const VALID_LENGTHS = [8, 12, 13, 14];

/** 숫자 이외 문자를 제거한다. (공백/하이픈 입력 허용) */
function normalizeBarcode(input) {
  return String(input ?? "").replace(/\D+/g, "");
}

/** GS1 체크 숫자 검증 (오른쪽 끝이 체크 숫자) */
function hasValidCheckDigit(code) {
  if (!/^\d+$/.test(code) || !VALID_LENGTHS.includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop();
  let sum = 0;
  // 체크 숫자 바로 왼쪽부터 가중치 3,1,3,1 …
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

function isPlausibleBarcode(code) {
  return /^\d+$/.test(code) && VALID_LENGTHS.includes(code.length);
}

module.exports = { normalizeBarcode, hasValidCheckDigit, isPlausibleBarcode, VALID_LENGTHS };
