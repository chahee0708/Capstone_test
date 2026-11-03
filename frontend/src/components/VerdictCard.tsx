/**
 * VerdictCard.tsx
 *
 * 역할: 분석 결과 맨 위의 "판정 카드". 제품명 + 큰 판정 글씨 + 판정 근거(VerdictExplanation)를 보여준다.
 *       2형 당뇨(ML 트랙) 사용자는 판정 아래에 GI 지수 한 줄이 추가된다.
 *
 * 이번에 바뀐 점:
 *   - 카드 위쪽(아이콘·제품명·판정 글씨·알레르기 배지)은 고정, 그 아래 내용만 슬라이드 (공용 SlidePager 재사용)
 *       알레르기 있음: 1페이지 = 판정 근거, 2페이지 = 알레르기 유발 성분
 *       알레르기 없음: 슬라이드 없이 판정 근거만 (버튼·페이지 번호·점 없음, 이전과 동일)
 *   - 알레르기 배지를 <button> 으로 변경 → 누르면 2페이지(알레르기 유발 성분)로 이동
 *     배지 문구: 1~2개 "알레르기 성분 포함 · 우유, 밀" / 3개 이상 "알레르기 성분 포함 · 우유 외 2개"
 *   - 카드 맨 아래 따로 있던 "알레르기 유발 성분" 상자는 2페이지로 옮겼다
 *
 * 이전 변경:
 *   - FoodAnalysisPage.tsx 의 두 판정 카드(GI 카드 / 일반 카드)를 이 컴포넌트 하나로 합침.
 *     카드 색·아이콘은 최종 verdict 기준 (알레르기가 없으면 GI 카드도 기존과 같은 색:
 *     백엔드가 GI Low/Medium/High 를 추천/주의/비추천 으로 그대로 바꾸기 때문)
 *
 * 알레르기 정보 없음 안내 (이번 추가):
 *   - allergyUnknown 이면 고정 영역 아래에 회색 안내 한 줄
 *     "이 제품은 알레르기 정보가 없어 확인이 필요해요. 포장의 원재료를 꼭 확인하세요."
 *     판정(색·글씨)은 바꾸지 않는다
 *
 * 쓰이는 곳: frontend/src/app/pages/FoodAnalysisPage.tsx (결과 화면 1번 블록)
 *            제품이 바뀌면 1페이지부터 보이도록 페이지에서 key={productName} 으로 쓴다
 */

import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { Card } from "../app/components/ui/card";
import {
  VerdictExplanation,
  type CarbInfo,
  type Reason,
} from "./VerdictExplanation";
import { SlidePager } from "./SlidePager";

export type Verdict = "추천" | "주의" | "비추천";

// 판정별 카드 색·아이콘 (기존 FoodAnalysisPage 의 색 그대로)
const VERDICT_STYLE = {
  추천: { card: "border-emerald-300 bg-emerald-50", text: "text-emerald-600", icon: CheckCircle },
  주의: { card: "border-amber-300 bg-amber-50", text: "text-amber-600", icon: AlertTriangle },
  비추천: { card: "border-red-300 bg-red-50", text: "text-red-600", icon: AlertCircle },
} as const;

// 2형 당뇨 GI 등급 안내 한 줄 (기존 GI_CONFIG 의 label/desc/color)
const GI_LINE = {
  Low: { text: "text-emerald-600", label: "GI 지수 낮음", desc: "혈당 영향이 적습니다" },
  Medium: { text: "text-amber-600", label: "GI 지수 중간", desc: "적당량 섭취를 권장합니다" },
  High: { text: "text-red-600", label: "GI 지수 높음", desc: "혈당이 빠르게 오를 수 있습니다" },
} as const;

// 알레르기 페이지 번호 (0부터)
const ALLERGY_PAGE = 1;

/**
 * 알레르기 배지 문구
 * 1~2개: "알레르기 성분 포함 · 우유, 밀" / 3개 이상: "알레르기 성분 포함 · 우유 외 2개"
 */
function allergyBadgeText(allergens: string[]): string {
  const names =
    allergens.length <= 2
      ? allergens.join(", ")
      : `${allergens[0]} 외 ${allergens.length - 1}개`;
  return `알레르기 성분 포함 · ${names}`;
}

type Props = {
  productName: string;
  verdict: Verdict; // 최종 판정 (알레르기 적용 후)
  nutritionVerdict?: Verdict; // 알레르기 적용 전 영양 판정
  giCategory: "Low" | "Medium" | "High" | null;
  reasons: Reason[];
  carbInfo: CarbInfo | null;
  allergens: string[]; // 걸린 알레르기 이름 (없으면 [])
  allergyUnknown?: boolean; // [추가] 알레르기 정보가 없어 확인이 필요한 제품
};

export function VerdictCard({
  productName,
  verdict,
  nutritionVerdict,
  giCategory,
  reasons,
  carbInfo,
  allergens,
  allergyUnknown = false,
}: Props) {
  const style = VERDICT_STYLE[verdict] ?? VERDICT_STYLE["비추천"];
  const Icon = style.icon;
  const gi = giCategory ? GI_LINE[giCategory] : null;
  const hasAllergy = allergens.length > 0;
  // 슬라이드 현재 페이지 (배지 클릭으로 바꾸기 위해 여기서 관리)
  const [page, setPage] = useState(0);

  return (
    <Card className={`p-6 border-2 ${style.card}`}>
      {/* ── 고정 영역: 아이콘 + 제품명 + 큰 판정 글씨 + 알레르기 배지 ── */}
      <div className="flex items-center gap-4">
        <Icon className={`w-10 h-10 shrink-0 ${style.text}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-500 mb-1">{productName}</p>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className={`text-2xl font-bold ${style.text}`}>{verdict}</h2>
            {/* 알레르기 배지: 누르면 2페이지(알레르기 유발 성분)로 이동 */}
            {hasAllergy && (
              <button
                type="button"
                aria-label="알레르기 성분 보기"
                onClick={() => setPage(ALLERGY_PAGE)}
                className="inline-flex items-center gap-1 rounded-full bg-red-700 hover:bg-red-800 text-white text-xs font-semibold px-3 py-1 text-left"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {allergyBadgeText(allergens)}
              </button>
            )}
          </div>
          {/* 2형 당뇨 사용자: GI 지수 안내 (기존 GI 카드의 한 줄) */}
          {gi && (
            <p className={`text-sm mt-1 ${gi.text}`}>
              {gi.label} — {gi.desc}
            </p>
          )}
        </div>
      </div>

      {/* ── [추가] 알레르기 정보 없음 안내 (회색, 판정에는 영향 없음) ── */}
      {allergyUnknown && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-gray-100 border border-gray-200 px-3 py-2.5 text-sm text-gray-600">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
          <p>이 제품은 알레르기 정보가 없어 확인이 필요해요. 포장의 원재료를 꼭 확인하세요.</p>
        </div>
      )}

      {/* ── 슬라이드 영역 ── */}
      <div className="mt-2 pt-4 border-t border-black/10">
        {hasAllergy ? (
          // 알레르기 있음: 판정 근거 / 알레르기 유발 성분 2페이지 (영양 정보 카드와 같은 SlidePager)
          <SlidePager
            page={page}
            onPageChange={setPage}
            headerClassName="mb-3"
            pages={[
              {
                key: "reasons",
                title: (
                  <>
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    판정 근거
                  </>
                ),
                content: (
                  <VerdictExplanation
                    reasons={reasons}
                    carbInfo={carbInfo}
                    allergyMode
                    nutritionVerdict={nutritionVerdict}
                    hideHeader
                  />
                ),
              },
              {
                key: "allergens",
                title: (
                  <>
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    알레르기 유발 성분
                  </>
                ),
                content: (
                  <div>
                    <p className="text-sm text-gray-700 mb-3">
                      회원님이 등록한 알레르기 성분이 들어 있어요.
                    </p>
                    <ul className="flex flex-wrap gap-2">
                      {allergens.map((name) => (
                        // "갑각류(새우)" 같은 값도 그대로 표시
                        <li
                          key={name}
                          className="rounded-full bg-red-50 text-red-700 border border-red-300 text-xs font-medium px-2.5 py-1"
                        >
                          {name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              },
            ]}
          />
        ) : (
          // 알레르기 없음: 슬라이드 없이 판정 근거만 (이전과 동일)
          <VerdictExplanation reasons={reasons} carbInfo={carbInfo} />
        )}
      </div>
    </Card>
  );
}
