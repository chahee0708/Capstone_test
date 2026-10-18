/**
 * FoodAnalysisPage.tsx
 *
 * 역할: 음식 이름을 입력받아 백엔드(/recommend)에 분석 요청하고 결과를 표시하는 페이지
 *
 * 쓰이는 곳: routes.ts 의 "/analysis" 경로 (홈 화면 링크로 진입)
 *
 * 표시 구조 (결과가 있을 때):
 *   1. 판정 카드 (VerdictCard) — 판정 + 판정 근거 + 알레르기 배지/성분 상자
 *      - 2형 당뇨 사용자: GI 지수 한 줄 추가
 *   2. 대체음식 섹션 (AlternativesSection) — 응답에 alternatives 가 있을 때만
 *   3. 영양 정보 슬라이드 카드 (NutritionSlideCard)
 *      - 1페이지: 영양소 균형 (NutrientRadarChart)
 *      - 2페이지: 영양성분 분석 (NutritionBreakdownList)
 *
 * ── 이번 변경(분석 페이지 개편) ──────────────────────────────
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
import { useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
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
import { VerdictCard } from "../../components/VerdictCard";
import {
  AlternativesSection,
  type Alternative,
} from "../../components/AlternativesSection";
import { NutritionSlideCard } from "../../components/NutritionSlideCard";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";//백엔드 로컬호스트 값

/**
 * 백엔드 /recommend 응답 타입
 * scoreService.js + recommend.js 반환 구조와 일치해야 함
 */
type AnalysisResult = {
  productName: string;
  userType: string;
  diseaseTrack: "diabetes" | "rule" | "healthy";
  // 최종 판정 (알레르기 성분이 있으면 항상 "비추천")
  verdict: "추천" | "주의" | "비추천";
  // 알레르기 적용 전 영양 판정
  nutritionVerdict?: "추천" | "주의" | "비추천";
  giCategory: "Low" | "Medium" | "High" | null;
  bmi: string;
  nutrition: {
    sugar: number;
    sodium: number;
    saturatedFat: number;
    protein: number;
    carbohydrate: number;
    calories: number;
  };
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
  // 알레르기 때문에 "비추천" 으로 강제됐는지
  allergyOverride?: boolean;
  // 대체음식 (다음 단계에서 백엔드가 보냄. 필드가 없으면 섹션을 숨긴다)
  alternatives?: Alternative[];
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

export function FoodAnalysisPage() {
  const { user, token } = useAuth();
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
    setSuggestions([]); // 분석 시작하면 후보 목록 닫기

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

  return (
    <div className="min-h-full bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">식품 분석</h1>
          <p className="text-gray-600">
            제품명을 검색하거나 영양성분표를 촬영하여 분석하세요
          </p>
        </div>

        <Tabs defaultValue="search" className="mb-8">
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
                  className="bg-emerald-600 hover:bg-emerald-700"
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
              <Button variant="outline">사진 촬영하기</Button>
            </Card>
          </TabsContent>
        </Tabs>

        {showResults && analysisResult && (() => {
          // 걸린 알레르기: 새 필드 allergens, 없으면 예전 필드 allergenAlert
          const allergens =
            analysisResult.allergens ?? analysisResult.allergenAlert ?? [];

          return (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* ── 1. 판정 카드 (알레르기 배지·결론·성분 상자 포함) ── */}
              {/* key: 제품이 바뀌면 판정 카드 슬라이드도 1페이지부터 */}
              <VerdictCard
                key={analysisResult.productName}
                productName={analysisResult.productName}
                verdict={analysisResult.verdict}
                nutritionVerdict={analysisResult.nutritionVerdict}
                giCategory={analysisResult.giCategory}
                reasons={analysisResult.reasons ?? []}
                carbInfo={analysisResult.carbInfo}
                allergens={allergens}
              />

              {/* ── 2. 대체음식 섹션: 응답에 alternatives 가 있을 때만 (지금은 백엔드가 안 보내서 숨김) ── */}
              {Array.isArray(analysisResult.alternatives) && (
                <AlternativesSection
                  alternatives={analysisResult.alternatives}
                  onSelect={handleSelectAlternative}
                />
              )}

              {/* ── 3. 영양 정보 슬라이드 카드 (1페이지 영양소 균형 / 2페이지 영양성분 분석) ──
                  key 로 제품이 바뀌면 1페이지부터 다시 보이게 한다 */}
              <NutritionSlideCard
                key={analysisResult.productName}
                radar={analysisResult.radar ?? []}
                calories={analysisResult.nutrition.calories}
                isMlTrack={analysisResult.diseaseTrack === "diabetes"}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}
