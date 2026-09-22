/**
 * VerdictExplanation.tsx
 *
 * 역할: 왜 이런 판정이 나왔는지를 "줄글(문단)"로 설명한다.
 *
 * 왜 만들었나 (변경 내용):
 *   기존에는 FoodAnalysisPage.tsx의 노란 "주의 영양소" 박스에
 *   "나트륨 보통 (1일 기준 13%) — 주의" 같은 문장이 리스트로 떴다.
 *   문제가 두 가지였다.
 *     1) "보통"(등급어)과 "주의"(판정어)가 한 문장에 섞여 있어 뜻이 어긋나 보였다.
 *     2) 어떤 기준을 얼마나 넘었는지, 근거가 무엇인지 알 수 없었다.
 *   그래서 등급어를 전부 없애고, 백엔드가 내려주는 reasons로 3문장 틀을 만들어 설명한다.
 *
 * 데이터 출처:
 *   백엔드 응답의 reasons / carbInfo
 *   (backend/services/scoreService.js의 combineResults, scoreForDiseaseUser가 생성)
 *
 * 호출하는 곳:
 *   frontend/src/app/pages/FoodAnalysisPage.tsx (노란 "주의 영양소" 박스 자리를 대체)
 */

import { AlertTriangle, Info } from "lucide-react";

/** 백엔드 reasons 배열의 원소 타입 */
export type Reason = {
  disease: string | null; // 질병명. 무질환 사용자는 null
  severityLabel?: string; // 이 한도를 정한 조건 (예: "중성지방 200 이상")
  nutrient?: string; // 영양소 이름 (ML 트랙에는 없음)
  amountPer100g?: number; // 제품 100g당 실제 수치
  unit?: string; // "g" 또는 "mg"
  thresholdPer100g?: number; // 넘어선 기준값 (100g당)
  verdict: "주의" | "비추천";
  source?: string; // 근거 출처 문자열
  track?: "ml"; // 2형 당뇨 AI 트랙 표시
  giCategory?: "Low" | "Medium" | "High";
};

/** 1형 당뇨 사용자에게만 내려오는 탄수화물 정보 */
export type CarbInfo = {
  amountPer100g: number;
  unit: string;
  source?: string;
};

// ─────────────────────────────────────────────────────────────
// 한국어 조사 처리
// ─────────────────────────────────────────────────────────────

/**
 * 단어의 마지막 글자에 받침이 있는지 판단한다.
 *
 * 원리: 한글 완성형 글자는 유니코드에서 0xAC00부터 28글자 단위로 묶여 있고,
 *      그 묶음 안 첫 번째 글자(나머지 0)가 받침 없는 글자다.
 *      예) "당류"의 '류' → 받침 없음 / "나트륨"의 '륨' → 받침 있음
 *
 * 한글이 아니면(숫자·영문) 받침 없음으로 처리한다.
 */
function hasBatchim(word: string): boolean {
  if (!word) return false;
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false; // 한글 완성형 범위 밖
  return (code - 0xac00) % 28 !== 0;
}

/**
 * 받침 여부에 따라 조사를 골라 "단어+조사" 형태로 돌려준다.
 * 예) josa("당류", "이", "가") → "당류가"
 *     josa("나트륨", "이", "가") → "나트륨이"
 */
function josa(word: string, withBatchim: string, withoutBatchim: string) {
  return word + (hasBatchim(word) ? withBatchim : withoutBatchim);
}

// ML 모델의 영어 등급 → 한국어 단어
const GI_LABEL: Record<string, string> = {
  High: "높음",
  Medium: "보통",
  Low: "낮음",
};

// ─────────────────────────────────────────────────────────────
// 문장 조립 함수들
// ─────────────────────────────────────────────────────────────

/**
 * ③번 문장의 뒷부분: 기준의 몇 배인지 / 몇 % 수준인지
 * 1배 이상이면 "약 N배", 1배 미만이면 "N% 수준"
 */
function ratioText(amount: number, threshold: number): string {
  if (!threshold || threshold <= 0) return "";
  const ratio = amount / threshold;
  if (ratio >= 1) {
    return `기준의 약 ${Math.round(ratio * 10) / 10}배입니다.`;
  }
  return `기준의 ${Math.round(ratio * 100)}% 수준입니다.`;
}

type Props = {
  reasons: Reason[];
  carbInfo?: CarbInfo | null;
};

export function VerdictExplanation({ reasons, carbInfo }: Props) {
  const list = reasons ?? [];

  // ── 주의가 필요한 영양소가 하나도 없는 경우 ──────────────
  if (list.length === 0) {
    return (
      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Info className="w-5 h-5 text-emerald-600" />
          판정 근거
        </h3>
        <p className="text-sm text-gray-700 leading-relaxed">
          현재 등록된 건강 정보 기준으로 주의가 필요한 영양소가 없습니다.
        </p>
        {/* 1형 당뇨 사용자에게는 이 경우에도 탄수화물 정보를 보여준다 */}
        {carbInfo && <CarbInfoParagraph carbInfo={carbInfo} />}
      </div>
    );
  }

  // ── 질병별로 묶는다 (①번 결론 문장을 질병당 1번만 쓰기 위해) ──
  // disease가 null(무질환 사용자)이면 "__general__" 이라는 임시 키로 묶는다
  const groups: { key: string; disease: string | null; items: Reason[] }[] = [];
  for (const r of list) {
    const key = r.disease ?? "__general__";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, disease: r.disease ?? null, items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }

  return (
    <div>
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-600" />
        판정 근거
      </h3>

      <div className="space-y-4">
        {groups.map((g) => {
          // 이 질병 안에서 가장 나쁜 판정을 ①번 결론 문장에 쓴다
          const worst = g.items.some((i) => i.verdict === "비추천")
            ? "비추천"
            : "주의";

          // ① 결론 문장
          const conclusion = g.disease
            ? `이 제품은 ${josa(g.disease, "이", "가")} 있는 분께 ${
                worst === "비추천" ? "비추천합니다" : "주의가 필요합니다"
              }.`
            : `이 제품은 일반 성인 기준으로 ${
                worst === "비추천" ? "비추천합니다" : "주의가 필요합니다"
              }.`;

          return (
            <div
              key={g.key}
              className={`rounded-lg p-4 border ${
                worst === "비추천"
                  ? "bg-red-50 border-red-200"
                  : "bg-amber-50 border-amber-200"
              }`}
            >
              {/* ① 결론 */}
              <p
                className={`text-sm font-semibold mb-2 ${
                  worst === "비추천" ? "text-red-700" : "text-amber-700"
                }`}
              >
                {conclusion}
              </p>

              {/* ②③ 영양소마다 기준 문장 + 제품 수치 문장 */}
              {g.items.map((r, i) => (
                <p
                  key={i}
                  className="text-sm text-gray-700 leading-relaxed mb-2 last:mb-0"
                >
                  {r.track === "ml"
                    ? // ── 2형 당뇨: AI 혈당지수 트랙 ──
                      `AI 모델이 이 음식의 혈당지수를 '${
                        GI_LABEL[r.giCategory ?? ""] ?? "알 수 없음"
                      }'으로 예측했습니다. (높음: GI 70 이상, 보통: 56~69, 낮음: 55 이하)`
                    : // ── 규칙 기반 트랙 ──
                      buildRuleSentences(r)}
                </p>
              ))}
            </div>
          );
        })}
      </div>

      {/* 1형 당뇨 전용 탄수화물 정보 */}
      {carbInfo && <CarbInfoParagraph carbInfo={carbInfo} />}
    </div>
  );
}

/**
 * 규칙 기반 판정의 ②번(기준+출처) + ③번(제품 수치) 문장을 만든다
 *
 * ② "{severityLabel}인 경우, 100g당 {영양소}이(가) {기준}{단위}을(를) 넘는 식품은 ... ({출처})"
 * ③ "이 제품은 100g당 {영양소}이(가) {수치}{단위}으로 기준의 약 N배입니다."
 */
function buildRuleSentences(r: Reason): string {
  const nutrient = r.nutrient ?? "";
  const unit = r.unit ?? "";
  const threshold = r.thresholdPer100g ?? 0;
  const amount = r.amountPer100g ?? 0;

  // severityLabel이 비어 있으면(1형 당뇨처럼 심각도 구분이 없는 경우) 앞머리를 생략한다
  const prefix = r.severityLabel ? `${r.severityLabel}인 경우, ` : "";

  // 비추천은 "피하는 것이 권장", 주의는 "주의가 필요"로 세기를 맞춘다
  const advice =
    r.verdict === "비추천"
      ? "넘는 식품은 피하는 것이 권장됩니다"
      : "넘는 식품은 주의가 필요합니다";

  const sourceText = r.source ? `(${r.source})` : "";

  // 단위 뒤 조사는 읽는 소리 기준으로 정한다.
  // "g"는 "그램", "mg"는 "밀리그램"으로 읽고 둘 다 받침(ㅁ)으로 끝나므로 항상 "을"이다.
  const sentence2 =
    `${prefix}100g당 ${josa(nutrient, "이", "가")} ${threshold}${unit}을 ${advice}${sourceText}.`;

  const sentence3 = `이 제품은 100g당 ${josa(
    nutrient,
    "이",
    "가",
  )} ${amount}${unit}으로 ${ratioText(amount, threshold)}`;

  return `${sentence2} ${sentence3}`;
}

/**
 * 1형 당뇨 사용자에게만 보이는 탄수화물 안내 문단
 * (STEP 5에서 탄수화물이 판정 대상에서 빠지고 정보 표시로 바뀌었기 때문에 필요)
 */
function CarbInfoParagraph({ carbInfo }: { carbInfo: CarbInfo }) {
  return (
    <div className="mt-4 rounded-lg p-4 bg-blue-50 border border-blue-200">
      <p className="text-sm text-blue-800 leading-relaxed">
        이 제품 100g에는 탄수화물이 {carbInfo.amountPer100g}
        {carbInfo.unit} 들어 있습니다. 식사 인슐린 용량을 정할 때 참고하세요.
      </p>
    </div>
  );
}
