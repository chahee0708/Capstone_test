/**
 * AlternativeCards.tsx
 *
 * 역할: "이건 어때요?" 대체식품 카드 줄. 판정 카드 바로 아래, 영양정보·원재료 박스 위에 놓인다
 *
 * 쓰이는 곳: HomePage.tsx, FoodAnalysisPage.tsx (NutritionFactsCard 의 afterVerdict 자리)
 *
 * 화면 구성:
 *   - 휴대폰: 카드를 옆으로 넘겨 본다 (가로 스크롤, 카드가 한 장씩 맞춰 멈춤)
 *   - 노트북(md 이상): 3칸 나란히
 *   - 카드 한 장: 카테고리 그림(원래 제품과 같은 중분류라 같은 그림) / 이름 / 판정 배지(추천 초록, 주의 노랑)
 *                 핵심 비교 "당류 17.3 → 8.1g · 53% 적음" (원래 제품을 문제로 만든 영양소, 100g당)
 *                 "원재료 82% 비슷" (원재료 유사도)
 *   - 카드를 누르면 onSelect(이름) → 그 제품으로 다시 분석
 *   - alternatives 가 [] 이면 섹션(제목 포함)을 그리지 않는다
 *     (응답에 alternatives 가 아예 없으면 = 추천 판정 → 이 컴포넌트를 그리지 않는다)
 */
import { ArrowDown } from "lucide-react";
import type { Alternative } from "./AlternativesSection";

const BADGE: Record<Alternative["verdict"], string> = {
  추천: "bg-[#388E3C] text-white",
  주의: "bg-amber-400 text-amber-950",
  비추천: "bg-red-600 text-white",
};

// 소수 첫째 자리까지, 정수면 소수점 없이
const fmt = (n: number) => String(Math.round(n * 10) / 10);

type Props = {
  alternatives: Alternative[];
  // 원래 제품의 카테고리 그림 (없으면 그림 칸 생략)
  icon?: string | null;
  onSelect: (name: string) => void;
};

export function AlternativeCards({ alternatives, icon, onSelect }: Props) {
  // 대체식품이 없으면 섹션(제목 포함)을 아예 그리지 않는다
  if (alternatives.length === 0) return null;

  return (
    <section aria-label="대체 식품 추천">
      <h3 className="font-semibold mb-2 px-1">이건 어때요?</h3>

      {(
        // 휴대폰: 가로 스크롤 / 노트북: 3칸 그리드. -mx/px 로 카드 그림자가 잘리지 않게
        <ul className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-2 md:grid md:grid-cols-3 md:overflow-visible">
          {alternatives.map((alt) => {
            const k = alt.keyNutrient;
            const less =
              k && k.before > 0 && k.after < k.before
                ? Math.round(((k.before - k.after) / k.before) * 100)
                : null;
            return (
              <li key={alt.name} className="snap-start shrink-0 w-[70%] sm:w-[45%] md:w-auto">
                <button
                  type="button"
                  onClick={() => onSelect(alt.name)}
                  className="w-full h-full text-left bg-white border border-gray-200 p-4 shadow-sm hover:shadow-md hover:border-[#388E3C]/40 transition"
                >
                  <div className="flex items-start gap-3">
                    {icon && (
                      <img src={icon} alt="" className="w-10 h-10 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 break-keep leading-snug">{alt.name}</p>
                      <span
                        className={`inline-block mt-1 text-xs font-bold px-2 py-0.5 rounded-full ${BADGE[alt.verdict]}`}
                      >
                        {alt.verdict}
                      </span>
                    </div>
                  </div>

                  {/* 핵심 비교: 원래 제품을 문제로 만든 영양소 (100g당) */}
                  {k && (
                    <div className="mt-3">
                      <p className="text-sm text-gray-700">
                        {k.label} {fmt(k.before)} → <span className="font-bold">{fmt(k.after)}{k.unit}</span>
                      </p>
                      {less !== null && (
                        <p className="flex items-center gap-0.5 text-sm font-bold text-[#388E3C]">
                          <ArrowDown className="w-4 h-4" />
                          {less}% 적음
                        </p>
                      )}
                    </div>
                  )}

                  {typeof alt.similarity === "number" && (
                    <p className="text-xs text-gray-400 mt-2">
                      원재료 {Math.round(alt.similarity * 100)}% 비슷
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
