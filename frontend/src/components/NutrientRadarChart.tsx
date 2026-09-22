/**
 * NutrientRadarChart.tsx
 *
 * 역할: 6개 영양소를 "100g 섭취 시 1일 한도의 몇 %인지"로 바꿔 방사형(거미줄) 그래프로 보여준다.
 *
 * 왜 만들었나 (변경 내용):
 *   기존에는 FoodAnalysisPage.tsx 안에 recharts BarChart(세로 막대)가 직접 박혀 있었다.
 *   막대 그래프는 영양소별로 기준이 다르다는 점(질병 기준 vs 일반 기준)을 보여주기 어려워서,
 *   축마다 기준이 다른 방사형 그래프로 교체했다.
 *
 * 데이터 출처:
 *   백엔드 응답의 radar 배열 (backend/services/scoreService.js의 buildRadar 함수가 생성)
 *
 * 호출하는 곳:
 *   frontend/src/app/pages/FoodAnalysisPage.tsx (세로 막대 그래프 자리를 대체)
 *
 * 사용 라이브러리:
 *   recharts 2.15.2 — 기존 프로젝트에 이미 설치된 것과 동일 (새로 설치한 패키지 없음)
 */

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

/**
 * 방사형 그래프 축 1개의 데이터 형태
 * backend buildRadar()가 내려주는 객체와 1:1로 대응된다
 */
export type RadarAxis = {
  nutrient: string; // 영양소 이름 (축 라벨)
  amountPer100g: number; // 이 제품 100g에 들어있는 양
  unit: string; // "g" 또는 "mg"
  dailyLimit: number; // 이 축의 기준(100%)이 되는 1일 한도
  percent: number; // (amountPer100g / dailyLimit) × 100
  basis: "disease" | "kdri"; // 기준이 질병 한도인지 일반 기준인지
  basisLabel: string; // 화면에 보여줄 기준 이름
};

// 비추천 판정 기준선 — 1일 한도의 25% (영국 FoP 공식)
const HIGH_LINE = 25;

// 그래프 바깥쪽 한계. 값이 이보다 커도 여기서 잘라서 그린다
// (200%, 500% 같은 값이 나오면 그래프가 찌그러져 다른 축을 읽을 수 없기 때문)
const AXIS_MAX = 100;

type Props = {
  /** 백엔드 응답의 radar 배열 */
  data: RadarAxis[];
  /** 100g당 열량 (제목 옆 배지에 표시) */
  calories: number;
  /** 판정이 2형 당뇨 ML 트랙인지 여부 → 추가 안내 문구 표시용 */
  isMlTrack: boolean;
};

export function NutrientRadarChart({ data, calories, isMlTrack }: Props) {
  // 데이터가 없으면 아무것도 그리지 않는다 (백엔드 구버전 응답 대비)
  if (!data || data.length === 0) return null;

  // recharts에 넘길 형태로 변환
  const chartData = data.map((d) => ({
    ...d,
    // 실제로 그려지는 값은 100에서 자른 값 (원본 percent는 그대로 들고 다녀서 툴팁에 쓴다)
    clipped: Math.min(d.percent, AXIS_MAX),
    // 25% 기준선을 육각형으로 그리기 위해 모든 축에 같은 값을 넣는다
    highLine: HIGH_LINE,
  }));

  // 축 라벨 색을 정하려면 "이 영양소가 25%를 넘었는지"를 알아야 한다 → 이름으로 찾는 표를 만든다
  const overMap: Record<string, boolean> = {};
  data.forEach((d) => {
    overMap[d.nutrient] = d.percent > HIGH_LINE;
  });

  /**
   * 축 라벨(영양소 이름)을 직접 그리는 함수
   * 25%를 넘은 영양소는 빨간색 + 굵게 표시한다
   */
  const renderAxisLabel = (props: any) => {
    const { payload, x, y, textAnchor } = props;
    const isOver = overMap[payload.value];
    return (
      <text
        x={x}
        y={y}
        textAnchor={textAnchor}
        dominantBaseline="central"
        className={isOver ? "fill-red-600 font-bold" : "fill-gray-600"}
        fontSize={12}
      >
        {payload.value}
      </text>
    );
  };

  /**
   * 툴팁 내용 — 잘리지 않은 "진짜 %"를 보여주는 게 핵심
   * 예: "포화지방 150% — 100g 섭취 시 1일 한도 대비"
   */
  const renderTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const d = payload[0].payload as RadarAxis & { clipped: number };
    return (
      <div className="bg-white p-3 border rounded-lg shadow-lg text-sm">
        <p className="font-semibold">
          {d.nutrient} {d.percent}%
        </p>
        <p className="text-gray-500 text-xs mt-0.5">
          100g 섭취 시 1일 한도 대비
        </p>
        <p className="text-gray-600 text-xs mt-1">
          {d.amountPer100g}
          {d.unit} / 1일 한도 {d.dailyLimit}
          {d.unit}
        </p>
        <p className="text-gray-400 text-xs mt-1">기준: {d.basisLabel}</p>
      </div>
    );
  };

  return (
    <div>
      {/* ── 제목 + 열량 배지 ── */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h3 className="font-semibold">영양소 균형</h3>
        <span className="text-xs font-medium bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">
          {calories} kcal / 100g
        </span>
      </div>

      {/* ── 기준 안내 ── */}
      <p className="text-xs text-gray-400">
        기준: 내 건강 정보에 따른 1일 한도 (질병 기준이 없는 영양소는 KDRI)
      </p>

      {/* ── 2형 당뇨 전용 안내 ──
          2형 당뇨는 영양소 한도가 아니라 AI 혈당지수 예측으로 판정하기 때문에,
          이 그래프와 판정 결과가 달라 보일 수 있다는 점을 미리 알려준다 */}
      {isMlTrack && (
        <p className="text-xs text-amber-600 mt-1">
          2형 당뇨 판정은 AI 혈당지수 예측으로 이루어지며, 이 그래프는 일반
          권장량 기준입니다.
        </p>
      )}

      {/* ── 방사형 그래프 ── */}
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={chartData} outerRadius="70%">
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis dataKey="nutrient" tick={renderAxisLabel} />
          {/* 0~100 고정. 축 숫자는 숨겨서 그래프를 깔끔하게 유지 */}
          <PolarRadiusAxis domain={[0, AXIS_MAX]} tick={false} axisLine={false} />

          {/* 25% 점선 육각형 — 모든 축에 25를 넣어 기준선처럼 보이게 한다 */}
          <Radar
            name="비추천 기준선 (100g당 1일 한도의 25%)"
            dataKey="highLine"
            stroke="#ef4444"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            fill="none"
            dot={false}
            isAnimationActive={false}
          />

          {/* 실제 제품 값 */}
          <Radar
            name="이 제품 (100g당)"
            dataKey="clipped"
            stroke="#10b981"
            strokeWidth={2}
            fill="#10b981"
            fillOpacity={0.35}
          />

          <Tooltip content={renderTooltip} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </RadarChart>
      </ResponsiveContainer>

      {/* ── 축별 기준 출처 (작은 글씨) ── */}
      <div className="mt-2 border-t pt-2">
        <p className="text-[11px] text-gray-400 mb-1">축별 기준</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
          {data.map((d) => (
            <li key={d.nutrient} className="text-[11px] text-gray-400">
              {d.nutrient} — {d.basisLabel} ({d.dailyLimit}
              {d.unit}/일)
            </li>
          ))}
        </ul>
        {/* 100%를 넘어 잘린 축이 있으면 알려준다 */}
        {data.some((d) => d.percent > AXIS_MAX) && (
          <p className="text-[11px] text-red-500 mt-1">
            * 100%를 넘는 값은 그래프에서 100%까지만 그려집니다. 실제 수치는
            그래프에 마우스를 올리면 볼 수 있습니다.
          </p>
        )}
      </div>
    </div>
  );
}
