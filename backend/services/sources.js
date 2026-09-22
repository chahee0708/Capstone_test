/**
 * sources.js
 *
 * 역할: 판정 근거(출처) 문자열을 한 곳에 모아두는 상수 파일
 *
 * 왜 필요한가:
 *   출처 문구가 scoreService.js 주석 곳곳에 흩어져 있으면,
 *   가이드라인 개정 때 여러 파일을 뒤져야 한다.
 *   이 파일 한 곳만 고치면 백엔드 응답(reasons.source)과 화면 문구가 동시에 바뀐다.
 *
 * 호출하는 곳:
 *   - backend/services/scoreService.js (reasons / radar 생성 시)
 *
 * 값의 근거:
 *   scoreService.js 각 판정 함수의 JSDoc 주석에 적힌 출처를 그대로 옮겨 적었다.
 *   (고혈압 Stage I만 사용자 지시에 따라 "ACC/AHA 2017"로 표기)
 */

module.exports = {
  // ── 고혈압: 나트륨 1일 한도 ───────────────────────────────
  // Stage I  = 2400mg (코드 주석 원문: Whelton PK et al., JACC 2018, Section 8)
  HYPERTENSION_STAGE1: "ACC/AHA 2017",
  // Stage II = 1500mg (코드 주석 원문: Sacks FM et al., NEJM 2001, DASH-Sodium)
  HYPERTENSION_STAGE2: "DASH-Sodium, NEJM 2001",

  // ── 이상지질혈증: 포화지방 / 탄수화물 / 당류 한도 ─────────
  // 코드 주석 원문: 한국지질동맥경화학회 이상지질혈증 진료지침 제5판 (2022) Chapter 3
  DYSLIPIDEMIA: "한국지질동맥경화학회 진료지침 제5판(2022)",

  // ── 트랜스지방: 1일 섭취열량의 1% 미만 ────────────────────
  // 코드 주석 원문: WHO 2023 (Global trans-fat elimination)
  TRANS_FAT: "WHO 2023",

  // ── 1형 당뇨 ──────────────────────────────────────────────
  // 당류: 1일 섭취열량의 10% 미만 (코드 주석 원문: ADA Standards 2024, Section 5, p.S77)
  TYPE1_SUGAR: "ADA Standards of Care 2024 Sec.5",
  // 탄수화물: 판정에서 제외하고 정보 표시로만 사용 (STEP 5 변경)
  TYPE1_CARB_INFO: "ADA Standards of Care 2024 Sec.5",

  // ── 신장병(CKD) ───────────────────────────────────────────
  // 나트륨 3000mg/일 (코드 주석 원문: 대한신장학회 가이드라인)
  CKD_SODIUM: "대한신장학회 가이드라인",
  // 단백질 GFR 단계별 (코드 주석 원문: KDIGO 2024, Chapter 3, p.117~125)
  CKD_PROTEIN: "KDIGO 2024 Chapter 3",

  // ── 무질환(일반 성인) 기준 ────────────────────────────────
  // 나트륨 / 당류 / 탄수화물 / 단백질: 한국인 영양소 섭취기준
  KDRI: "한국인 영양소 섭취기준(KDRI) 2020",

  // ── 판정 공식 (모든 질병 공통) ────────────────────────────
  // HIGH = 1일 한도 × 25% / 100g, LOW = 1일 한도 × 5.6% / 100g
  // 코드 주석 원문: UK DoH/FSA FoP Guidance (2016), Annex 3 Table 2, p.19
  FOP_THRESHOLD: "UK FoP 2016",

  // ── 2형 당뇨: ML(혈당지수 예측) 트랙 ──────────────────────
  ML_GI: "SafeBite AI 혈당지수 예측 모델",
};
