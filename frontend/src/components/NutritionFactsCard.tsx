/**
 * NutritionFactsCard.tsx
 *
 * 역할: 분석 결과 화면 맨 위. 제품명(+카테고리 그림) 아래에 영양정보 표와 원재료 표를 보여준다
 *       (두 표 모두 식품 라벨 모양: 검은 테두리 + 검은 머리. 원재료 표 아래 알레르기 유발성분은 검은 바탕 한 줄)
 *
 * 쓰이는 곳: frontend/src/app/pages/FoodAnalysisPage.tsx (결과 영역 1번)
 *
 * 화면 구성:
 *   - 휴대폰: 영양정보 표 → 원재료 표 세로로 / 노트북(md 이상): 2칸
 *   - 영양성분: 바깥 박스 없이 영양정보 표만. 표 안 검은 머리 아래 "기준량" 줄의 "1개" / "100g(ml)" 버튼 또는 입력칸으로 기준량을 정한다
 *       처음 값은 1개 양 (serving 이 없으면, 예: OCR 결과는 100)
 *       응답 값은 100g(ml)당 → 화면에서 값 × 기준량 ÷ 100 으로 환산
 *       입력칸이 비었거나 0 이하이면 값 대신 "-"
 *     식품 라벨 모양 "영양정보" 표 + 1일 영양성분 기준치에 대한 비율(%)
 *       % 는 2,000kcal 고정이 아니라 응답의 dailyValues (사용자 성별·나이 KDRI 기준) 로 계산
 *       트랜스지방은 기준치가 없어 % 없음 (라벨과 같음)
 *     판정 근거(reasons)가 된 영양소 이름에 형광펜: 주의 = 노랑, 비추천 = 빨강
 *   - 원재료: 쉼표로 이어 쓴 글. 설명이 있는 원재료는 점선 밑줄 → 마우스를 올리거나(노트북) 누르면(휴대폰)
 *     설명 말풍선 (backend/data/ingredient_info.csv 의 분류·설명. 출처는 검토 전이라 표시하지 않음)
 */
import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../app/components/ui/popover";
import { getCategoryIcon } from "./categoryIcons";
import { useAuth } from "../contexts/AuthContext";

const BRAND = "#388E3C";

export type NutritionValues = {
  calories: number;
  sodium: number;
  carbohydrate: number;
  sugar: number;
  fat?: number;
  transFat?: number;
  saturatedFat: number;
  cholesterol?: number;
  protein: number;
};

export type IngredientInfo = {
  name: string;
  category: string | null;
  description: string | null;
  source: string | null;
  // [추가] 복합원재료 조각 (예: "식물성크림[팜핵경화유(인도네시아산), 물엿]").
  //        이름 전체로 설명을 못 찾았을 때만 온다. text 를 이어 붙이면 원래 이름과 같다
  parts?: IngredientPart[];
};

/** 원재료 조각: 설명이 있으면 name(설명표 이름, 예: "밀가루1" → "밀가루")·category·description 도 있다 */
export type IngredientPart = {
  text: string;
  name?: string;
  category?: string | null;
  description?: string | null;
};

export type ServingInfo = {
  pieceAmount: number; // 1개 양 (g 또는 ml)
  pieceLabel: string; // 예: "1개", "1봉지"
  totalAmount: number; // 총 내용량
};

// 라벨 순서. sub=true 는 바로 위 항목의 세부 항목
const ROWS: { key: keyof NutritionValues; label: string; unit: string; sub?: boolean }[] = [
  { key: "calories", label: "열량", unit: "kcal" },
  { key: "sodium", label: "나트륨", unit: "mg" },
  { key: "carbohydrate", label: "탄수화물", unit: "g" },
  { key: "sugar", label: "당류", unit: "g", sub: true },
  { key: "fat", label: "지방", unit: "g" },
  { key: "transFat", label: "트랜스지방", unit: "g", sub: true },
  { key: "saturatedFat", label: "포화지방", unit: "g", sub: true },
  { key: "cholesterol", label: "콜레스테롤", unit: "mg" },
  { key: "protein", label: "단백질", unit: "g" },
];

// 소수 첫째 자리까지, 정수면 소수점 없이 (416.67 → 416.7, 120 → 120)
const fmt = (n: number) => String(Math.round(n * 10) / 10);

type Props = {
  productName: string;
  nutrition: NutritionValues;
  ingredients: IngredientInfo[];
  unit: "g" | "ml";
  // 통합 중분류 (예: "아이스크림"). OCR 결과에는 없다
  category?: string | null;
  serving?: ServingInfo | null;
  // 음식에 든 알레르기 성분 전체 (예: ["우유", "대두"])
  allergens: string[];
  // [추가] allergens 를 어디서 찾았나. "ingredients" 면 원재료 이름에서 찾은 것 → 작게 표시
  allergensSource?: "db" | "label" | "ingredients" | null;
  // 그중 사용자 알레르기에 걸린 것 (응답의 allergens. 예: ["우유", "갑각류(새우)"])
  myAllergens: string[];
  // 개인별 1일 기준치 (% 계산용). 없으면 % 칸이 비어 보인다
  dailyValues?: DailyValues | null;
  // 판정 근거 (형광펜 표시용). nutrient 가 ROWS 의 label 과 같은 것만 쓴다
  reasons: { nutrient?: string; verdict: "주의" | "비추천" }[];
  // 제품명 아래에 끼워 넣을 판정 카드 (VerdictSummaryCard). 없으면 생략
  verdictCard?: ReactNode;
  // 제품명 오른쪽 끝에 놓을 버튼 (HomePage 의 관심 식품 하트). 없으면 생략
  headerAction?: ReactNode;
};

export type DailyValues = {
  energy: number;
  values: Partial<Record<keyof NutritionValues, number>>;
};

// 형광펜 색 (글자 아래쪽 절반만 칠한 모양)
const MARKER = {
  주의: "linear-gradient(transparent 45%, #FDE68A 45%)",
  비추천: "linear-gradient(transparent 45%, #FCA5A5 45%)",
} as const;

/** "새우" 가 내 알레르기인지: "새우" 그대로 또는 묶음 이름 "갑각류(새우)" 로 들어 있으면 true */
function isMyAllergen(name: string, myAllergens: string[]) {
  return myAllergens.some((m) => m === name || m.endsWith(`(${name})`));
}

export function NutritionFactsCard({
  productName, nutrition, ingredients, unit, category, serving, allergens, allergensSource, myAllergens,
  dailyValues, reasons, verdictCard, headerAction,
}: Props) {
  const { user } = useAuth(); // 표 아래 "○○님의 ..." 문구용
  const icon = getCategoryIcon(category);
  // 기준량 입력칸: 처음 값은 1개 양 (없으면 100). 비우거나 0 이하이면 값 대신 "-"
  const [amountText, setAmountText] = useState(fmt(serving?.pieceAmount ?? 100));
  const parsed = Number(amountText);
  const amount = amountText.trim() !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  // 빠른 선택 버튼: 1개(있을 때) + 100g(ml). 1개 양이 100 이면 버튼 하나만
  const presets = [
    ...(serving ? [{ label: serving.pieceLabel, amount: serving.pieceAmount }] : []),
    { label: `100${unit}`, amount: 100 },
  ].filter((p, i, list) => list.findIndex((o) => o.amount === p.amount) === i);

  /** 기준량으로 환산한 값 (글자). 값이나 기준량이 없으면 "-" */
  const scaled = (key: keyof NutritionValues) => {
    const per100 = nutrition[key];
    return per100 === undefined || per100 === null || amount === null
      ? "-"
      : fmt((per100 * amount) / 100);
  };

  /** 개인별 1일 기준치에 대한 비율 (정수 %). 기준치가 없는 영양소(트랜스지방)는 null */
  const percentOf = (key: keyof NutritionValues) => {
    const per100 = nutrition[key];
    const daily = dailyValues?.values[key];
    if (per100 === undefined || per100 === null || amount === null || !daily) return null;
    return Math.round(((per100 * amount) / 100 / daily) * 100);
  };

  // 영양소별 가장 나쁜 판정 (주의 < 비추천). 2형 당뇨 AI 판정처럼 영양소가 없는 근거는 제외
  const highlights: Partial<Record<keyof NutritionValues, "주의" | "비추천">> = {};
  for (const r of reasons) {
    const key = ROWS.find((row) => row.label === r.nutrient)?.key;
    if (!key) continue;
    if (highlights[key] !== "비추천") highlights[key] = r.verdict;
  }

  return (
    <div className="space-y-4">
      {/* ── 제품명 + 카테고리 그림 ── */}
      <div className="flex items-center gap-4">
        {icon && (
          <div
            className="shrink-0 w-16 h-16 md:w-20 md:h-20 flex items-center justify-center bg-white border"
          >
            <img src={icon} alt={category ?? ""} className="w-12 h-12 md:w-16 md:h-16" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {category && <p className="text-sm text-gray-500 mb-0.5">{category}</p>}
          <h2 className="text-xl md:text-2xl font-bold break-keep">{productName}</h2>
        </div>
        {/* 제품명 오른쪽 끝 버튼 (예: 관심 식품 하트). 없으면 생략 */}
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>

      {/* ── 판정 카드 (결론 먼저): 제품명 바로 아래, 영양정보·원재료 위 ── */}
      {verdictCard}

      <div className="grid gap-4 md:grid-cols-2 items-start">
          {/* ── 영양정보 표 (식품 라벨 모양) ── 바깥 박스 없이 표만 */}
          <div className="border-2 border-gray-900 overflow-hidden text-gray-900 bg-white">
            {/* 검은 머리: 영양정보 | 기준량 + 열량 */}
            {/* 검은 머리 높이: 원재료 표 머리와 같게 h-16 고정 */}
            <div className="h-16 flex items-center justify-between gap-3 bg-gray-900 text-white px-3">
              {/* self-center: 오른쪽 두 줄(기준량·열량)의 가운데 높이로 → 아래 붙어 있던 것보다 조금 위 */}
              <span className="self-center text-2xl font-extrabold tracking-tight leading-none whitespace-nowrap">영양정보</span>
              <span className="text-right leading-tight">
                <span className="block text-xs">
                  {amount === null ? "-" : `${fmt(amount)}${unit}`}당
                </span>
                <span className="block text-lg font-extrabold">
                  {scaled("calories")}kcal
                </span>
              </span>
            </div>

            {/* 기준량 줄: 1개 / 100g 버튼 + 직접 입력 (휴대폰에서도 열 제목과 겹치지 않게 따로 한 줄) */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-300 bg-gray-50 text-xs">
              <span className="font-medium text-gray-700 shrink-0">기준량</span>
              <div className="flex items-center gap-1" role="group" aria-label="영양성분 기준량">
                {/* 빠른 선택 버튼: 지금 입력값과 같으면 브랜드색 */}
                {presets.map((p) => {
                  const active = amount === p.amount;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setAmountText(fmt(p.amount))}
                      aria-pressed={active}
                      className={`h-7 px-2 text-xs rounded-full border whitespace-nowrap transition-colors ${
                        active ? "text-white" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                      }`}
                      style={active ? { backgroundColor: BRAND, borderColor: BRAND } : undefined}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <label className="flex items-center gap-0.5 ml-0.5 text-xs text-gray-700 whitespace-nowrap">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    aria-label={`영양성분 기준량 (${unit})`}
                    className="w-12 h-7 px-1 text-right text-xs rounded-md border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2"
                    style={{ ["--tw-ring-color" as string]: `${BRAND}66` }}
                  />
                  {unit}당
                </label>
              </div>
            </div>

            {/* 열 제목 (식품 라벨과 같은 모양) */}
            <div className="flex items-end justify-between px-3 py-1.5 border-b-2 border-gray-900 text-xs">
              <span>{amount === null ? "-" : `${fmt(amount)}${unit}`}당</span>
              <span className="text-right leading-tight">
                1일 영양성분
                <br />
                기준치에 대한 비율
              </span>
            </div>

            {ROWS.filter((r) => r.key !== "calories").map(({ key, label, unit: u, sub }) => {
              const level = highlights[key];
              const percent = percentOf(key);
              return (
                <div
                  key={key}
                  className={`flex items-center justify-between gap-2 border-b border-gray-300 last:border-b-0 py-1.5 pr-3 ${
                    sub ? "pl-7" : "pl-3"
                  }`}
                >
                  <span className="text-sm">
                    {/* 형광펜: 주의 = 노랑, 비추천 = 빨강 (판정 근거가 된 영양소만) */}
                    <span
                      className={`px-0.5 rounded-sm ${sub ? "" : "font-bold"}`}
                      style={level ? { background: MARKER[level] } : undefined}
                    >
                      {label}
                    </span>
                    <span className="ml-1.5">
                      {scaled(key)}
                      {u}
                    </span>
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {percent === null ? "" : `${percent}%`}
                  </span>
                </div>
              );
            })}

            {/* 아래 설명: 2,000kcal 대신 사용자 성별·나이 기준 (예: "김시연님의 ... 1900kcal 기준입니다.") */}
            <p className="text-[11px] leading-snug bg-gray-900 text-white px-3 py-1.5">
              {user?.name ? `${user.name}님의 ` : ""}1일 영양성분 기준치에 대한 비율(%)
              {dailyValues ? `인 ${dailyValues.energy}kcal 기준입니다.` : "은 개인별 기준입니다."}
            </p>
          </div>

        {/* ── 원재료 표: 영양정보 표와 같은 모양 (검은 테두리 + 검은 머리) ── */}
        <div className="border-2 border-gray-900 overflow-hidden text-gray-900 bg-white">
          {/* 검은 머리 높이: 영양정보 표 머리와 같게 h-16 고정 */}
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
                    // [추가] 괄호가 긴 복합원재료: 조각마다 설명 (설명 없는 조각은 그냥 글자)
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

          {/* ── 알레르기 유발성분: 테두리와 같은 검은 바탕, 제목과 성분을 한 줄로 ("알레르기 유발성분 우유, 대두")
                 음식에 든 성분 전체. 내 알레르기와 겹치면 빨간 굵은 글씨 ── */}
          <p className="bg-gray-900 text-white text-sm leading-relaxed px-3 py-2">
            <span className="font-bold mr-2">알레르기 유발성분</span>
            {allergens.length === 0 ? (
              <span className="text-gray-300">
                {/* [변경] 원재료가 있으면 원재료 이름까지 찾아본 것 */}
                {ingredients.length > 0 ? "원재료에서 찾은 성분 없음" : "정보 없음"} (포장의 표시를 확인하세요)
              </span>
            ) : (
              allergens.map((name, i) => {
                const mine = isMyAllergen(name, myAllergens);
                return (
                  <span key={name}>
                    <span className={mine ? "text-red-400 font-bold" : ""}>
                      {name}
                      {mine && <span className="sr-only"> (내 알레르기)</span>}
                    </span>
                    {i < allergens.length - 1 && ", "}
                  </span>
                );
              })
            )}
            {/* [추가] 알레르기 정보 대신 원재료 이름에서 찾은 경우 */}
            {allergens.length > 0 && allergensSource === "ingredients" && (
              <span className="block text-xs text-gray-300 mt-0.5">
                원재료명에서 찾은 성분이에요. 포장의 알레르기 표시도 확인하세요.
              </span>
            )}
          </p>
        </div>
      </div>
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
          // text-sm leading-7: theme.css 의 button 기본 글자 크기(text-base) 대신 주변 글자와 같게
          className="text-sm leading-7 align-baseline underline decoration-dotted underline-offset-4 hover:text-[#1B5E20] cursor-help"
          style={{ textDecorationColor: BRAND }}
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
        {/* 글자 크기를 모두 직접 지정 (theme.css 의 p 기본 크기가 적용되지 않게) */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-sm font-semibold">{info.name}</span>
          {info.category && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: `${BRAND}1A`, color: "#1B5E20" }}
            >
              {info.category}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-700 leading-relaxed">{info.description}</p>
        {/* 출처는 보여주지 않는다: ingredient_info.csv 의 출처가 검토되지 않은 문서 이름뿐이라 (CSV 의 source 열은 남겨 둠) */}
      </PopoverContent>
    </Popover>
  );
}
