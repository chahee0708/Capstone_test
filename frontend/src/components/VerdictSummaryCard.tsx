/**
 * VerdictSummaryCard.tsx
 *
 * 역할: 분석 결과의 "결론" 카드. 제품명 바로 아래, 영양정보·원재료 박스보다 위에 놓인다
 *
 * 쓰이는 곳: frontend/src/components/NutritionFactsCard.tsx (verdict 를 넘기면 제품명 아래에 그린다)
 *
 * 화면 구성 (위에서부터):
 *   1. 판정 배지 + 한 줄 결론   추천 = 초록 "안심하고 드셔도 좋아요"
 *                              주의 = 노랑 "조금만 드시는 게 좋아요"
 *                              비추천 = 빨강 "피하는 게 좋아요"
 *   2. "고혈압 · 이상지질혈증 기준" (질병이 없으면 "일반 성인 기준")
 *   3. 원인 영양소 태그: 아래 영양정보 표의 형광펜과 같은 색 (비추천 = 빨강, 주의 = 노랑), 비추천 먼저
 *      2형 당뇨면 "AI 혈당지수 예측: 높음" 한 줄 / 1형 당뇨면 탄수화물 양 한 줄
 *   4. 내 알레르기 성분 빨간 띠 (판정 등급과 별개. 걸린 성분이 있을 때만)
 *      알레르기 정보가 없거나(allergyUnknown) 사진 결과의 혼입 가능·확인 미완료 안내도 여기
 *   5. "판정 근거 자세히 보기" — 누르면 질병별 기준·제품 수치·출처 줄글 (VerdictExplanation 재사용)
 */
import { useState } from "react";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";
import { VerdictExplanation, type Reason, type CarbInfo } from "./VerdictExplanation";
import type { AnalysisResult } from "../app/pages/FoodAnalysisPage";

/** 분석 응답 하나로 판정 카드 만들기 (홈·분석 페이지가 같은 방식으로 쓰게) */
export function verdictCardFor(result: AnalysisResult) {
  return (
    <VerdictSummaryCard
      key={result.productName}
      verdict={result.verdict}
      reasons={result.reasons ?? []}
      diseases={result.diseases ?? []}
      giCategory={result.giCategory}
      carbInfo={result.carbInfo}
      myAllergens={result.allergens ?? result.allergenAlert ?? []}
      allergyUnknown={result.allergyUnknown}
      mayContainAlerts={result.mayContainAlerts}
      allergyCheckIncomplete={result.allergyCheckIncomplete}
    />
  );
}

type Verdict = "추천" | "주의" | "비추천";

// 판정별 색과 한 줄 결론
const STYLE: Record<Verdict, { badge: string; panel: string; text: string; message: string }> = {
  추천: {
    badge: "bg-[#388E3C] text-white",
    panel: "bg-[#388E3C]/10 border-[#388E3C]/30",
    text: "text-[#1B5E20]",
    message: "안심하고 드셔도 좋아요",
  },
  주의: {
    badge: "bg-amber-400 text-amber-950",
    panel: "bg-amber-50 border-amber-200",
    text: "text-amber-900",
    message: "조금만 드시는 게 좋아요",
  },
  비추천: {
    badge: "bg-red-600 text-white",
    panel: "bg-red-50 border-red-200",
    text: "text-red-800",
    message: "피하는 게 좋아요",
  },
};

// 원인 태그 색: 영양정보 표 형광펜(NutritionFactsCard 의 MARKER)과 같은 색
const CAUSE_TAG: Record<"주의" | "비추천", string> = {
  주의: "bg-[#FDE68A] text-amber-950",
  비추천: "bg-[#FCA5A5] text-red-950",
};

const GI_LABEL: Record<string, string> = { High: "높음", Medium: "보통", Low: "낮음" };

type Props = {
  verdict: Verdict;
  reasons: Reason[];
  diseases: string[];
  giCategory?: "Low" | "Medium" | "High" | null;
  carbInfo?: CarbInfo | null;
  // 내 알레르기 중 이 제품에 든 것 (예: ["우유", "갑각류(새우)"])
  myAllergens: string[];
  // 내 알레르기가 있는데 이 제품에 알레르기 정보가 없음
  allergyUnknown?: boolean;
  // 사진(OCR) 결과에만: 혼입 가능 성분 중 내 알레르기, 라벨 알레르기 문구 확인 미완료
  mayContainAlerts?: string[];
  allergyCheckIncomplete?: boolean;
};

export function VerdictSummaryCard({
  verdict, reasons, diseases, giCategory, carbInfo, myAllergens,
  allergyUnknown, mayContainAlerts = [], allergyCheckIncomplete,
}: Props) {
  const [open, setOpen] = useState(false);
  const style = STYLE[verdict];

  // 원인 영양소: 영양소별 가장 나쁜 판정, 비추천 먼저 (2형 당뇨 AI 근거는 영양소가 없어 제외)
  const causes = new Map<string, "주의" | "비추천">();
  for (const r of reasons) {
    if (!r.nutrient || r.track === "ml") continue;
    if (causes.get(r.nutrient) !== "비추천") causes.set(r.nutrient, r.verdict);
  }
  const causeList = [...causes.entries()].sort(
    (a, b) => (b[1] === "비추천" ? 1 : 0) - (a[1] === "비추천" ? 1 : 0),
  );
  const giReason = reasons.find((r) => r.track === "ml");
  const gi = giReason?.giCategory ?? giCategory ?? null;

  return (
    <section className={`border p-5 ${style.panel}`} aria-label="판정 결과">
      {/* 1. 판정 + 한 줄 결론 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`text-lg font-extrabold px-3.5 py-1 rounded-full ${style.badge}`}>
          {verdict}
        </span>
        <p className={`text-lg font-bold ${style.text}`}>{style.message}</p>
      </div>

      {/* 2. 판정 기준 */}
      <p className="text-sm text-gray-600 mt-2">
        {diseases.length > 0 ? `${diseases.join(" · ")} 기준` : "일반 성인 기준"}
      </p>

      {/* 3. 원인 영양소 + 당뇨 정보 */}
      {(causeList.length > 0 || gi || carbInfo) && (
        <div className="mt-4 space-y-2">
          {causeList.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-gray-700 mr-1">원인</span>
              {causeList.map(([nutrient, level]) => (
                <span
                  key={nutrient}
                  className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${CAUSE_TAG[level]}`}
                >
                  {nutrient}
                  <span className="sr-only"> ({level})</span>
                </span>
              ))}
            </div>
          )}
          {gi && (
            <p className="text-sm text-gray-700">
              <span className="font-medium">AI 혈당지수 예측</span>: {GI_LABEL[gi] ?? gi}
            </p>
          )}
          {carbInfo && (
            <p className="text-sm text-gray-700">
              <span className="font-medium">탄수화물</span>: 100g당 {carbInfo.amountPer100g}
              {carbInfo.unit} (인슐린 용량 참고)
            </p>
          )}
        </div>
      )}

      {/* 4. 알레르기 (판정 등급과 별개) */}
      {myAllergens.length > 0 && (
        <div className="mt-4 flex items-start gap-2 bg-red-600 text-white px-3 py-2.5 text-sm font-medium">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>내 알레르기 성분: {myAllergens.join(", ")}</span>
        </div>
      )}
      {mayContainAlerts.length > 0 && (
        <div className="mt-2 flex items-start gap-2 bg-amber-100 text-amber-900 px-3 py-2.5 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>혼입 가능 주의: {mayContainAlerts.join(", ")}</span>
        </div>
      )}
      {(allergyUnknown || (allergyCheckIncomplete && myAllergens.length === 0)) && (
        <div className="mt-2 flex items-start gap-2 bg-white/70 text-gray-600 px-3 py-2.5 text-sm">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {allergyUnknown
              ? "이 제품은 알레르기 정보가 없어요. 포장의 원재료를 꼭 확인하세요."
              : "라벨의 알레르기 문구를 모두 확인하지 못했어요. 포장의 원재료를 꼭 확인하세요."}
          </span>
        </div>
      )}

      {/* 5. 판정 근거 (접기/펼치기) */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`mt-4 flex items-center gap-1 text-sm font-medium ${style.text} hover:underline`}
      >
        판정 근거 {open ? "접기" : "자세히 보기"}
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 bg-white p-4">
          <VerdictExplanation reasons={reasons} carbInfo={carbInfo} hideHeader />
        </div>
      )}
    </section>
  );
}
