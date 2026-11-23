/**
 * NutritionBreakdownList.tsx
 *
 * 역할: "영양성분 분석" 목록. 영양소마다 "100g당 양 / 1일 한도 (몇 %)" 와 가로 막대를 보여준다.
 *
 * 이번에 바뀐 점:
 *   - [추가] 막대마다 1일 한도 25% 위치에 빨간 점선 (레이더 그래프의 비추천 기준선과 같은 값, HIGH_LINE)
 *       목록 아래에 점선 설명 한 줄
 *
 * 이전 변경:
 *   - FoodAnalysisPage.tsx 안에 있던 "영양 성분 분석" 카드 내용을 그대로 옮겨 컴포넌트로 분리했다.
 *     (영양 정보 슬라이드 카드의 2페이지로 쓰기 위해서. 값·기준·계산은 변경 없음)
 *   - 제목 줄은 슬라이드 카드가 공통으로 그리므로 여기에는 없다.
 *
 * 데이터 출처: 백엔드 응답의 radar 배열 (레이더 그래프와 같은 기준)
 *
 * 쓰이는 곳: frontend/src/components/NutritionSlideCard.tsx (2페이지)
 */

import { Progress } from "../app/components/ui/progress";
import type { RadarAxis } from "./NutrientRadarChart";

// 비추천 판정 기준선 — 1일 한도의 25% (NutrientRadarChart 의 HIGH_LINE 과 같은 값)
const HIGH_LINE = 25;

type Props = {
  /** 백엔드 응답의 radar 배열 */
  data: RadarAxis[];
};

export function NutritionBreakdownList({ data }: Props) {
  // 영양 성분 목록도 레이더 그래프와 같은 기준(백엔드 radar)을 사용한다
  const nutritionData = (data ?? []).map((d) => ({
    name: d.nutrient,
    value: d.amountPer100g,
    max: d.dailyLimit,
    unit: d.unit,
  }));

  return (
    <div>
      {/* 기준값 출처 표시 — 레이더 그래프(내 질병 기준)와 같은 기준임을 명시 */}
      <p className="text-xs text-gray-400 mb-4">
        기준: 내 건강 정보에 따른 1일 한도 (질병 기준이 없는 영양소는 KDRI)
      </p>
      <div className="space-y-4">
        {nutritionData.map((item, index) => {
          // 100g 섭취 시 1일 권장량의 몇 %인지
          const percent = Math.round((item.value / item.max) * 100);
          return (
            <div key={index}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">{item.name}</span>
                {/* g과 % 를 함께 표기: 예) 60g / 422g (14%) */}
                <span className="text-sm text-gray-600">
                  {item.value}
                  {item.unit} / {item.max}
                  {item.unit} ({percent}%)
                </span>
              </div>
              {/* Progress는 100을 넘으면 꽉 찬 상태로 보이므로 값을 100에서 자른다 */}
              <div className="relative">
                <Progress value={Math.min(percent, 100)} className="h-2" />
                {/* [추가] 25% 한도선 (빨간 점선) — 초록 막대(h-2)와 같은 높이 */}
                <div
                  aria-hidden
                  className="absolute inset-y-0 border-l-2 border-dashed border-red-500"
                  style={{ left: `${HIGH_LINE}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-4">
        괄호 안 %는 이 제품을 100g 섭취했을 때 1일 한도 대비 비율입니다.
      </p>
      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
        <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-red-500" />
        비추천 기준선 (100g당 1일 한도의 25%)
      </p>
    </div>
  );
}
