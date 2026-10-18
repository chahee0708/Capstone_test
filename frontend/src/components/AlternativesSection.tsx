/**
 * AlternativesSection.tsx
 *
 * 역할: "이런 음식은 어때요?" 대체음식 섹션. 같은 종류 중 사용자에게 더 나은 음식을 최대 3개 카드로 보여준다.
 *
 * 이번에 바뀐 점 (새 파일, 이번엔 틀만):
 *   - 백엔드 /recommend 응답에 alternatives 필드가 있을 때만 FoodAnalysisPage 가 이 섹션을 그린다.
 *     지금은 백엔드가 보내지 않으므로 화면에 안 보이는 게 정상. (다음 단계에서 백엔드가 형식을 맞춤)
 *   - 빈 배열이면 "같은 종류에서 더 나은 음식을 찾지 못했어요." 한 줄만 표시
 *   - 카드를 누르면 onSelect(음식 이름) → 분석 페이지가 그 이름으로 다시 분석한다
 *
 * ── 이번 변경(백엔드 대체음식 연결) — 디자인 변경 없음, 형식만 맞춤 ──
 *   - keyNutrient 가 null 일 수 있음 (문제 영양소를 특정할 수 없는 경우, 예: 2형 당뇨 AI 판정)
 *     → null 이면 영양소 비교 두 줄을 그리지 않는다 (이전에는 null 이면 화면 오류)
 *   - similarity(유사도, 소수 둘째 자리) 필드를 타입에 추가 (화면에는 표시하지 않음)
 *
 * 쓰이는 곳: frontend/src/app/pages/FoodAnalysisPage.tsx (결과 화면 2번 블록)
 */

import { Card } from "../app/components/ui/card";

/** 백엔드 alternatives 배열 원소 형식 (다음 단계에서 백엔드가 이 형식으로 보냄) */
export type Alternative = {
  name: string;
  verdict: "추천" | "주의" | "비추천";
  similarity?: number; // 원재료 유사도 0~1 (소수 둘째 자리)
  // 원래 음식에서 문제가 된 영양소 비교. 특정할 수 없으면 null
  keyNutrient: {
    label: string; // 예) "당류"
    unit: string; // 예) "g"
    before: number; // 지금 분석한 음식의 100g당 값
    after: number; // 이 대체음식의 100g당 값
  } | null;
  sharedIngredients: string[]; // 지금 음식과 겹치는 원재료
};

// 판정 배지 색: 추천 = 초록, 주의 = 주황 (비추천은 원래 오지 않지만 대비용으로 빨강)
const BADGE_STYLE: Record<Alternative["verdict"], string> = {
  추천: "bg-emerald-100 text-emerald-700",
  주의: "bg-amber-100 text-amber-700",
  비추천: "bg-red-100 text-red-700",
};

const MAX_CARDS = 3;

type Props = {
  alternatives: Alternative[];
  /** 카드 클릭 시 그 음식 이름으로 분석 */
  onSelect: (foodName: string) => void;
};

export function AlternativesSection({ alternatives, onSelect }: Props) {
  const items = alternatives.slice(0, MAX_CARDS);

  return (
    <Card className="p-6">
      {/* ── 제목 + 부제 ── */}
      <h3 className="font-semibold">이런 음식은 어때요?</h3>
      <p className="text-xs text-gray-500 mt-0.5 mb-4">
        같은 종류 중 회원님께 더 나은 음식을 원재료가 비슷한 순서로 골랐어요.
      </p>

      {items.length === 0 ? (
        // ── 대체음식을 못 찾은 경우 ──
        <p className="text-sm text-gray-600">같은 종류에서 더 나은 음식을 찾지 못했어요.</p>
      ) : (
        // ── 카드 목록: 한 줄 3칸, 좁은 화면에서는 세로로 쌓임 ──
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {items.map((alt) => {
            const key = alt.keyNutrient; // null 이면 비교 줄 생략
            return (
              <li key={alt.name}>
                <button
                  type="button"
                  onClick={() => onSelect(alt.name)}
                  className="w-full h-full text-left rounded-lg border bg-white p-4 hover:border-emerald-400 hover:shadow-sm transition"
                >
                  {/* 이름 + 판정 배지 */}
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900 break-keep">{alt.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        BADGE_STYLE[alt.verdict] ?? BADGE_STYLE["주의"]
                      }`}
                    >
                      {alt.verdict}
                    </span>
                  </div>
                  {/* 핵심 영양소 비교: 지금 음식 → 대체음식 (100g당) */}
                  {key && (
                    <>
                      <p className="text-xs text-gray-500 mt-3">{key.label} (100g당)</p>
                      <p className="text-sm font-medium text-gray-800">
                        {key.before}
                        {key.unit} → {key.after}
                        {key.unit}
                      </p>
                    </>
                  )}
                  {/* 겹치는 원재료 앞 2개 */}
                  {alt.sharedIngredients.length > 0 && (
                    <p className="text-xs text-gray-500 mt-2">
                      비슷한 원재료 · {alt.sharedIngredients.slice(0, 2).join(", ")}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
