/**
 * NutritionSlideCard.tsx
 *
 * 역할: "영양소 균형"(레이더 그래프)과 "영양성분 분석"(목록)을 한 카드 안에서 넘겨 보는 슬라이드 카드.
 *       1페이지 = 영양소 균형 (처음에 보임), 2페이지 = 영양성분 분석
 *
 * 이번에 바뀐 점:
 *   - 슬라이드 동작(버튼·점·스와이프·높이 고정)을 공용 SlidePager 로 옮기고 여기서는 그것을 쓴다.
 *     판정 카드도 같은 SlidePager 를 쓴다. 화면 모양·동작은 이전과 같다.
 *   - 카드 제목은 페이지에 따라 바뀌고, 옆의 kcal 배지는 두 페이지 공통.
 *   - 레이더·목록 내용과 계산은 기존 컴포넌트(NutrientRadarChart, NutritionBreakdownList) 그대로.
 *
 * 쓰이는 곳: frontend/src/app/pages/FoodAnalysisPage.tsx (결과 화면 3번 블록)
 */

import { Card } from "../app/components/ui/card";
import { NutrientRadarChart, type RadarAxis } from "./NutrientRadarChart";
import { NutritionBreakdownList } from "./NutritionBreakdownList";
import { SlidePager } from "./SlidePager";

type Props = {
  /** 백엔드 응답의 radar 배열 */
  radar: RadarAxis[];
  /** 100g당 열량 (제목 옆 배지) */
  calories: number;
  /** 2형 당뇨 ML 트랙 여부 (레이더 안내 문구용) */
  isMlTrack: boolean;
};

export function NutritionSlideCard({ radar, calories, isMlTrack }: Props) {
  return (
    <SlidePager
      // 점은 카드 바깥 아래, 제목 줄 + 페이지는 카드 안
      frame={(inner) => <Card className="p-6">{inner}</Card>}
      headerExtra={
        // kcal 배지: 두 페이지 공통
        <span className="text-xs font-medium bg-gray-100 text-gray-700 rounded-full px-2.5 py-1 whitespace-nowrap">
          {calories} kcal / 100g
        </span>
      }
      pages={[
        {
          key: "balance",
          title: "영양소 균형",
          content: (
            <NutrientRadarChart data={radar} calories={calories} isMlTrack={isMlTrack} hideHeader />
          ),
        },
        {
          key: "breakdown",
          title: "영양성분 분석",
          content: <NutritionBreakdownList data={radar} />,
        },
      ]}
    />
  );
}
