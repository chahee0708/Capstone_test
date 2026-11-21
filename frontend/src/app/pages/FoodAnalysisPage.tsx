/**
 * FoodAnalysisPage.tsx
 *
 * 역할: 음식 이름을 입력받아 백엔드(/recommend)에 분석 요청하고 결과를 표시하는 페이지
 *
 * 쓰이는 곳: routes.ts 의 "/analysis" 경로 (홈 화면 링크로 진입)
 *
 * 표시 구조 (결과가 있을 때):
 *   1. 판정 카드 (VerdictCard) — 판정 + 판정 근거 + 알레르기 경고(배지/상자/성분 목록)
 *      - 2형 당뇨 사용자: GI 지수 한 줄 추가
 *   2. 대체음식 섹션 (AlternativesSection) — 응답에 alternatives 가 있을 때만
 *   3. 영양 정보 슬라이드 카드 (NutritionSlideCard)
 *      - 1페이지: 영양소 균형 (NutrientRadarChart)
 *      - 2페이지: 영양성분 분석 (NutritionBreakdownList)
 *
 * ── 이번 변경(OCR 탭 연결) ───────────────────────────────────
 *   - 사진 선택 → POST /ocr/label → 제품명과 100g당 영양성분 9개를 수정 칸으로 표시, 알레르기 문구 표시
 *   - "이 값으로 분석하기" → POST /recommend/label → 기존 결과 화면 사용
 *   - 결과 화면에 혼입 가능 주의, 알레르기 확인 미완료 안내 추가 (OCR 결과에만 값이 있다)
 *
 * ── 이전 변경(알레르기는 경고로만 표시) ────────────────────────
 *   - VerdictCard 에 nutritionVerdict 전달 제거 (경고 문구는 VerdictCard 가 allergens 로 표시)
 *   - 응답 타입 필드는 그대로, verdict / nutritionVerdict / allergyOverride 주석만 새 규칙에 맞춤
 *
 * ── 이전 변경(분석 페이지 개편) ──────────────────────────────
 *   - 판정 카드 2종(GI 카드 / 일반 카드)을 VerdictCard 컴포넌트 하나로 합침
 *   - 별도 알레르기 카드 삭제 → 판정 카드 안으로 이동 (배지 + 결론 문장 + 성분 상자)
 *   - 응답 타입에 nutritionVerdict / allergens / allergyOverride / alternatives 추가
 *   - 대체음식 섹션 틀 추가 (카드 클릭 → 그 음식 이름으로 이 페이지에서 바로 다시 분석)
 *   - 레이더 카드와 영양성분 목록 카드를 슬라이드 카드 하나로 합침 (내용·계산은 그대로)
 *   - handleAnalyze 가 음식 이름을 인자로 받을 수 있게 변경 (대체음식 클릭용)
 *   - 바코드 기능 화면에서 삭제: 바코드 탭(스캔 안내·카메라 열기 버튼) 제거 → 검색 / OCR 2개 탭,
 *     페이지 안내 문구에서 바코드 언급 제거
 *   - 판정 카드에 key={productName} → 다른 제품을 분석하면 판정 카드 슬라이드가 1페이지부터
 *
 * ── 이전 변경 요약 ───────────────────────────────────────────
 * STEP 2: 세로 막대 그래프(recharts BarChart)를 NutrientRadarChart로 교체.
 *         가로 막대(Progress)는 그대로 유지.
 * STEP 3: 가로 막대 오른쪽 표기를 "60g / 422g (14%)" 형태로 변경.
 *         포화지방 max값 20g 하드코딩 제거 → 에너지 × 7% ÷ 9 로 계산.
 * STEP 4: 노란 "주의 영양소" 박스 제거 → VerdictExplanation(줄글)로 교체.
 *         warnings 필드는 응답에 그대로 남아 있지만 화면에서는 쓰지 않는다.
 *
 * 호출하는 컴포넌트:
 *   - frontend/src/components/VerdictCard.tsx (안에서 VerdictExplanation 사용)
 *   - frontend/src/components/AlternativesSection.tsx
 *   - frontend/src/components/NutritionSlideCard.tsx (안에서 NutrientRadarChart, NutritionBreakdownList 사용)
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../../contexts/AuthContext";
import { prepareImageForOcr } from "../../components/prepareImageForOcr";
import { Search, Camera, AlertCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card } from "../components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { type RadarAxis } from "../../components/NutrientRadarChart";
import { type Reason, type CarbInfo } from "../../components/VerdictExplanation";
import { type Alternative } from "../../components/AlternativesSection";
import { verdictCardFor } from "../../components/VerdictSummaryCard";
import { AlternativeCards } from "../../components/AlternativeCards";
import { getCategoryIcon } from "../../components/categoryIcons";
import {
  NutritionFactsCard,
  type NutritionValues,
  type IngredientInfo,
  type ServingInfo,
  type DailyValues,
} from "../../components/NutritionFactsCard";

const API_URL = import.meta.env.VITE_API_URL || "/api"; // 백엔드는 /api 로 (vite.config.ts 의 proxy 가 백엔드로 넘김)

/**
 * 백엔드 /recommend 응답 타입
 * scoreService.js + recommend.js 반환 구조와 일치해야 함
 */
export type AnalysisResult = {
  productName: string;
  userType: string;
  diseaseTrack: "diabetes" | "rule" | "healthy";
  // 최종 판정 (영양 판정 그대로. 알레르기는 등급에 영향을 주지 않는다)
  verdict: "추천" | "주의" | "비추천";
  // 영양 판정 (verdict 와 같은 값. 응답 형식 유지용)
  nutritionVerdict?: "추천" | "주의" | "비추천";
  giCategory: "Low" | "Medium" | "High" | null;
  // [추가] 사용자 질병 목록 (판정 카드 "○○ 기준" 문구용)
  diseases?: string[];
  bmi: string;
  // 100g(또는 100ml)당 영양성분 9개
  nutrition: NutritionValues;
  // [추가] 원재료 + 설명 (검색: DB order 순, OCR: 라벨에서 읽은 순서). 설명이 없으면 description null
  ingredients?: IngredientInfo[];
  // [추가] 1개 양 / 총 내용량. 없으면 null (100g당만 표시)
  serving?: ServingInfo | null;
  // [추가] 음식에 든 알레르기 성분 전체 (사용자와 무관). 정보 없으면 []
  foodAllergens?: string[];
  // [추가] 영양정보 표 % 용 개인별 1일 기준치 (성별·나이 KDRI)
  dailyValues?: DailyValues | null;
  // [추가] 영양성분 기준 단위
  unit?: "g" | "ml";
  // [추가] 통합 중분류 (카테고리 그림용). OCR 결과에는 없다
  category?: string | null;
  // 구버전 호환용으로 응답에는 남아 있지만 화면에서는 더 이상 쓰지 않는다
  warnings: string[];
  // 판정 근거 줄글용 (VerdictExplanation)
  reasons: Reason[];
  // 방사형 그래프 6축 (NutrientRadarChart)
  radar: RadarAxis[];
  // 1형 당뇨 사용자에게만 값이 들어온다. 그 외에는 null
  carbInfo: CarbInfo | null;
  // 예전 필드 (allergens 와 같은 값). 구버전 응답 대비로 남겨 둔다
  allergenAlert: string[];
  // 걸린 알레르기 이름 배열 (없으면 []). 예) ["우유", "갑각류(새우)"]
  allergens?: string[];
  // 항상 false (알레르기로 판정을 바꾸지 않는다. 응답 형식 유지용)
  allergyOverride?: boolean;
  // [추가] 사용자 알레르기가 있는데 이 제품에 알레르기 정보가 없으면 true (판정 카드 회색 안내)
  allergyUnknown?: boolean;
  // 대체음식 (다음 단계에서 백엔드가 보냄. 필드가 없으면 섹션을 숨긴다)
  alternatives?: Alternative[];
  // [추가] OCR 결과에만 있는 값: 혼입 가능 성분 중 사용자 알레르기에 걸린 이름, 알레르기 확인 미완료 여부
  mayContainAlerts?: string[];
  allergyCheckIncomplete?: boolean;
  // 성별+나이 기반 KDRI 1일 기준값 (프론트 차트 max값으로 사용)
  // 예: 남성 25세 → { 나트륨: 2300, 당류: 130, 탄수화물: 130, 단백질: 65, 식이섬유: 30 }
  dailyReference: {
    에너지: number;
    나트륨: number;
    당류: number;
    // STEP 1-3 이후: KDRI 권장섭취량 130g이 아니라 에너지 × 65% ÷ 4 로 계산된 값이 들어온다
    탄수화물: number;
    단백질: number;
    식이섬유: number;
  };
};

// OCR 수정 칸에 보여줄 영양성분 9개 (키는 foodService.getFoodNutrition 과 같다)
const LABEL_NUTRIENTS = [
  { key: "calories", label: "열량", unit: "kcal" },
  { key: "sodium", label: "나트륨", unit: "mg" },
  { key: "carbohydrate", label: "탄수화물", unit: "g" },
  { key: "sugar", label: "당류", unit: "g" },
  { key: "fat", label: "지방", unit: "g" },
  { key: "transFat", label: "트랜스지방", unit: "g" },
  { key: "saturatedFat", label: "포화지방", unit: "g" },
  { key: "cholesterol", label: "콜레스테롤", unit: "mg" },
  { key: "protein", label: "단백질", unit: "g" },
];

// POST /ocr/label 응답 중 이 화면에서 쓰는 값. 영양성분은 수정할 수 있게 문자열로 보관한다
type LabelForm = {
  productName: string;
  nutrition: Record<string, string>;
  ingredients: string[];
  allergenText: string[];
  mayContain: string[];
  warnings: string[];
};

export function FoodAnalysisPage() {
  const { user, token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // 탭: 홈에서 사진을 넘겨받으면 OCR 탭을 열어야 해서 직접 관리
  const [tab, setTab] = useState<"search" | "ocr">("search");
  // OCR 탭 상태
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isReadingLabel, setIsReadingLabel] = useState(false);
  const [labelForm, setLabelForm] = useState<LabelForm | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");

  // ── 자동완성: 입력한 글자가 들어간 제품명 후보 ──────────────
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // 글자를 칠 때마다 요청하지 않도록 0.3초 기다리는 타이머
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 입력칸 글자가 바뀔 때: 0.3초 뒤 후보 목록 요청 */
  const handleQueryChange = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/recommend/search?q=${encodeURIComponent(value.trim())}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        setSuggestions(res.ok ? await res.json() : []);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  };

  /** 후보를 클릭했을 때: 입력칸에만 채우고 목록 닫기 (분석은 직접 누름) */
  const handleSelectSuggestion = (name: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchQuery(name);
    setSuggestions([]);
  };
  /**
   * 분석 버튼 클릭 또는 Enter 입력 시 실행
   * foodName 을 넘기면 입력칸 대신 그 이름으로 분석한다 (대체음식 카드 클릭용)
   */
  const handleAnalyze = async (foodName?: string) => {
    const name = (foodName ?? searchQuery).trim();
    if (!name) return;
    setIsAnalyzing(true);
    setShowResults(false);
    setErrorMessage("");
    // 분석 시작하면 후보 목록 닫기. 대기 중인 자동완성 요청도 취소 (입력 직후 Enter 시 목록이 다시 뜨던 문제)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSuggestions([]);

    try {
      const response = await fetch(`${API_URL}/recommend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ foodName: name, userId: user?.id ?? 1 }),
      });

      if (!response.ok) {
        const err = await response.json();
        setErrorMessage(err.message || "음식을 찾을 수 없습니다.");
        return;
      }

      const data = await response.json();
      setAnalysisResult(data);
      setShowResults(true);
    } catch {
      setErrorMessage(
        "서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * 대체음식 카드 클릭 시: 검색해서 분석하는 것과 같은 방식으로 이 페이지에서 바로 분석
   * (입력칸에 이름을 채우고 분석 → 화면 맨 위로 이동)
   */
  const handleSelectAlternative = (name: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchQuery(name);
    window.scrollTo({ top: 0, behavior: "smooth" });
    handleAnalyze(name);
  };

  /** 사진 선택 시: POST /ocr/label 로 글자를 읽어 수정 칸을 채운다 */
  const handleLabelFile = async (file: File | undefined) => {
    if (!file) return;
    setIsReadingLabel(true);
    setLabelForm(null);
    setShowResults(false);
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.append("image", await prepareImageForOcr(file)); // 방향 바로잡고 크기 줄여서 (prepareImageForOcr)
      const response = await fetch(`${API_URL}/ocr/label`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(data.error || "라벨을 읽지 못했습니다.");
        return;
      }

      // 못 읽은 값(null)은 빈 칸으로 둔다 (0 으로 채우지 않는다)
      const nutrition: Record<string, string> = {};
      for (const { key } of LABEL_NUTRIENTS) {
        const value = data.nutritionPer100g?.[key];
        nutrition[key] = value === null || value === undefined ? "" : String(value);
      }
      setLabelForm({
        productName: data.productName ?? "",
        nutrition,
        ingredients: data.ingredients ?? [],
        allergenText: data.allergenText ?? [],
        mayContain: data.mayContain ?? [],
        warnings: data.warnings ?? [],
      });
    } catch {
      setErrorMessage("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
    } finally {
      setIsReadingLabel(false);
      // 같은 사진을 다시 골라도 동작하도록 선택을 비운다
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /** "이 값으로 분석하기": 수정 칸의 값으로 POST /recommend/label 호출 → 기존 결과 화면 */
  const handleAnalyzeLabel = async () => {
    if (!labelForm) return;
    setIsAnalyzing(true);
    setShowResults(false);
    setErrorMessage("");

    // 빈 칸은 null 로 보낸다 → 백엔드가 400 으로 막는다
    const nutritionPer100g: Record<string, number | null> = {};
    for (const { key } of LABEL_NUTRIENTS) {
      const value = labelForm.nutrition[key].trim();
      nutritionPer100g[key] = value === "" ? null : Number(value);
    }

    try {
      const response = await fetch(`${API_URL}/recommend/label`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          userId: user?.id ?? 1,
          productName: labelForm.productName.trim(),
          nutritionPer100g,
          allergenText: labelForm.allergenText,
          mayContain: labelForm.mayContain,
          ocrWarnings: labelForm.warnings,
          ingredients: labelForm.ingredients,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(data.message || "분석에 실패했습니다.");
        return;
      }
      setAnalysisResult(data);
      setShowResults(true);
    } catch {
      setErrorMessage("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * [추가] 홈 화면에서 넘어온 경우 바로 실행
   *   { query }     : 검색창에 채우고 분석
   *   { labelFile } : OCR 탭을 열고 라벨 읽기
   * 한 번만 실행(개발 모드에서 effect 가 두 번 돌아도 OCR 을 두 번 부르지 않게)하고,
   * 새로고침 때 다시 실행되지 않도록 넘겨받은 state 를 지운다
   */
  const handledHomeRef = useRef(false);
  useEffect(() => {
    if (handledHomeRef.current) return;
    const state = location.state as { query?: string; labelFile?: File } | null;
    if (!state) return;
    handledHomeRef.current = true;
    navigate(location.pathname, { replace: true, state: null });

    if (state.query) {
      setTab("search");
      setSearchQuery(state.query);
      handleAnalyze(state.query);
    } else if (state.labelFile) {
      setTab("ocr");
      handleLabelFile(state.labelFile);
    }
    // 처음 한 번만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-full bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">식품 분석</h1>
          <p className="text-gray-600">
            제품명을 검색하거나 영양성분표를 촬영하여 분석하세요
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "search" | "ocr")} className="mb-8">
          {/* 바코드 탭 삭제 → 검색 / OCR 2칸 */}
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="search">
              <Search className="w-4 h-4 mr-2" />
              검색
            </TabsTrigger>
            <TabsTrigger value="ocr">
              <Camera className="w-4 h-4 mr-2" />
              OCR
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-4">
            <Card className="p-6">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    placeholder="제품명을 입력하세요 (예: 불닭볶음면)"
                    value={searchQuery}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleAnalyze()}
                    onBlur={() => setSuggestions([])}
                  />
                  {/* 자동완성 후보 목록 */}
                  {suggestions.length > 0 && (
                    <ul className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {suggestions.map((name) => (
                        <li key={name}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                            // onClick 대신 onMouseDown: 입력칸 onBlur보다 먼저 실행되게
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSelectSuggestion(name);
                            }}
                          >
                            {name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button
                  onClick={() => handleAnalyze()}
                  disabled={isAnalyzing}
                  className="bg-[#388E3C] hover:bg-[#1B5E20]"
                >
                  {isAnalyzing ? "분석 중..." : "분석"}
                </Button>
              </div>
              {errorMessage && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {errorMessage}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="ocr">
            <Card className="p-12 text-center">
              <Camera className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600 mb-4">영양성분표를 촬영하세요</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleLabelFile(e.target.files?.[0])}
              />
              <Button
                variant="outline"
                disabled={isReadingLabel}
                onClick={() => fileInputRef.current?.click()}
              >
                {isReadingLabel ? "라벨 읽는 중..." : "사진 촬영하기"}
              </Button>
            </Card>

            {/* 읽은 값 확인·수정 */}
            {labelForm && (
              <Card className="p-6 mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="label-product-name">
                    제품명
                  </label>
                  <Input
                    id="label-product-name"
                    value={labelForm.productName}
                    onChange={(e) =>
                      setLabelForm({ ...labelForm, productName: e.target.value })
                    }
                  />
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">영양성분 (100g당)</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {LABEL_NUTRIENTS.map(({ key, label, unit }) => (
                      <div key={key}>
                        <label className="block text-sm text-gray-600 mb-1" htmlFor={`label-${key}`}>
                          {label} ({unit})
                        </label>
                        <Input
                          id={`label-${key}`}
                          type="number"
                          min="0"
                          step="any"
                          value={labelForm.nutrition[key]}
                          onChange={(e) =>
                            setLabelForm({
                              ...labelForm,
                              nutrition: { ...labelForm.nutrition, [key]: e.target.value },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-sm text-gray-700 space-y-1">
                  <p>함유: {labelForm.allergenText.join(", ") || "읽은 문구 없음"}</p>
                  <p>혼입 가능: {labelForm.mayContain.join(", ") || "읽은 문구 없음"}</p>
                </div>

                {labelForm.warnings.length > 0 && (
                  <ul className="text-sm text-amber-700 list-disc pl-5">
                    {labelForm.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}

                <Button
                  onClick={handleAnalyzeLabel}
                  disabled={isAnalyzing}
                  className="bg-[#388E3C] hover:bg-[#1B5E20]"
                >
                  {isAnalyzing ? "분석 중..." : "이 값으로 분석하기"}
                </Button>
              </Card>
            )}

            {errorMessage && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {errorMessage}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* ── 결과 화면: 처음부터 다시 쌓는 중 ──
            1. 영양성분 + 원재료 카드 (NutritionFactsCard)
            예전 카드(VerdictCard, AlternativesSection, NutritionSlideCard)는 파일은 그대로 두고
            화면에서만 뺐다. 하나씩 다시 넣을 예정 */}
        {showResults && analysisResult && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <NutritionFactsCard
              key={analysisResult.productName}
              productName={analysisResult.productName}
              nutrition={analysisResult.nutrition}
              ingredients={analysisResult.ingredients ?? []}
              unit={analysisResult.unit ?? "g"}
              category={analysisResult.category}
              serving={analysisResult.serving}
              allergens={analysisResult.foodAllergens ?? []}
              myAllergens={analysisResult.allergens ?? analysisResult.allergenAlert ?? []}
              dailyValues={analysisResult.dailyValues}
              reasons={analysisResult.reasons ?? []}
              verdictCard={
                <>
                  {verdictCardFor(analysisResult)}
                  {/* 대체식품: 주의·비추천일 때만 응답에 alternatives 가 온다 */}
                  {Array.isArray(analysisResult.alternatives) && (
                    <AlternativeCards
                      alternatives={analysisResult.alternatives}
                      icon={getCategoryIcon(analysisResult.category)}
                      onSelect={handleSelectAlternative}
                    />
                  )}
                </>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
