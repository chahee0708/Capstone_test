/**
 * IngredientsCard.tsx
 *
 * 역할: 분석 결과의 원재료 목록. 설명이 있는 원재료는 점선 밑줄 →
 *       마우스를 올리거나(노트북) 누르면(휴대폰) 분류·설명 말풍선
 *       (설명: backend/data/ingredient_info.csv → 응답의 ingredients[].description)
 *       복합원재료는 백엔드가 조각(parts)으로 나눠 보내면 조각마다 말풍선
 *
 * 쓰이는 곳: frontend/src/app/pages/FoodAnalysisPage.tsx
 *
 * 이번 변경: 표기 모양을 seohee 브랜치 NutritionFactsCard 의 "원재료" 표와 같게
 *   검은 굵은 테두리 + 검은 머리(흰 글씨 "원재료") + 쉼표로 이어 쓴 원재료 (식품 라벨 모양)
 *
 * 이전 변경: 새 파일 (seohee 브랜치 NutritionFactsCard 의 원재료 부분을 옮김)
 */
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../app/components/ui/popover";

export type IngredientPart = {
  text: string;
  name?: string;
  category?: string | null;
  description?: string | null;
};

export type IngredientInfo = {
  name: string;
  category: string | null;
  description: string | null;
  source: string | null;
  // 이름 전체로 설명을 못 찾았을 때만 온다. text 를 이어 붙이면 원래 이름과 같다
  parts?: IngredientPart[];
};

export function IngredientsCard({ ingredients }: { ingredients: IngredientInfo[] }) {
  return (
    // 식품 라벨 모양: 검은 테두리 + 검은 머리 (seohee 브랜치 원재료 표와 같은 모양)
    <div className="border-2 border-gray-900 overflow-hidden text-gray-900 bg-white">
      <div className="h-16 flex items-center bg-gray-900 text-white px-3">
        <h3 className="text-2xl font-extrabold tracking-tight leading-tight">원재료</h3>
      </div>
      {ingredients.length === 0 ? (
        <p className="text-sm text-gray-500 px-3 py-3">원재료 정보가 없어요.</p>
      ) : (
        <p className="text-sm leading-7 text-gray-800 break-keep px-3 py-2">
          {ingredients.map((ing, i) => (
            <span key={`${ing.name}-${i}`}>
              {ing.description ? (
                <IngredientWithInfo label={ing.name} info={ing} />
              ) : ing.parts ? (
                ing.parts.map((p, j) =>
                  p.description ? (
                    <IngredientWithInfo
                      key={j}
                      label={p.text}
                      info={{ name: p.name ?? p.text, category: p.category ?? null, description: p.description }}
                    />
                  ) : (
                    <span key={j}>{p.text}</span>
                  ),
                )
              ) : (
                ing.name
              )}
              {i < ingredients.length - 1 && ", "}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** 설명이 있는 원재료: 마우스를 올리면 열리고, 누르면 열고 닫는다 (휴대폰용) */
function IngredientWithInfo({
  label,
  info,
}: {
  label: string; // 원재료 칸에 보이는 글자 (예: "밀가루1")
  info: { name: string; category: string | null; description: string | null }; // 말풍선 (예: "밀가루")
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-sm leading-7 align-baseline underline decoration-dotted decoration-[#388E3C] underline-offset-4 hover:text-[#1B5E20] cursor-help"
          // 마우스일 때만 올리면 열기 (휴대폰 터치는 누르기로만 열고 닫는다)
          onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-64 p-3 text-xs rounded-none"
        // 마우스로 연 말풍선이 입력 포커스를 가져가지 않게
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-sm font-semibold">{info.name}</span>
          {info.category && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[#388E3C]/10 text-[#1B5E20]">
              {info.category}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-700 leading-relaxed">{info.description}</p>
      </PopoverContent>
    </Popover>
  );
}
