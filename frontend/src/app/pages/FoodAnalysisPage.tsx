/**
 * FoodAnalysisPage.tsx
 *
 * 역할: 음식 이름을 입력받아 백엔드(/recommend)에 분석 요청하고 결과를 표시하는 페이지
 *
 * 표시 구조 (결과가 있을 때):
 *   1. 판정 카드 (추천/주의/비추천)
 *      - 2형 당뇨 사용자: GI 지수 정보 포함
 *      - 다른 질병 사용자: 판정 라벨만 표시
 *   2. 판정 근거 줄글 (VerdictExplanation 컴포넌트)
 *   3. 영양소 균형 — 방사형 그래프 (NutrientRadarChart 컴포넌트)
 *   4. 영양 성분 분석 — 가로 막대 (KDRI 일반 성인 기준)
 *   5. 알레르기 유발 성분 카드
 *
 * ── 이번 변경 요약 ───────────────────────────────────────────
 * STEP 2: 세로 막대 그래프(recharts BarChart)를 NutrientRadarChart로 교체.
 *         가로 막대(Progress)는 그대로 유지.
 * STEP 3: 가로 막대 오른쪽 표기를 "60g / 422g (14%)" 형태로 변경.
 *         포화지방 max값 20g 하드코딩 제거 → 에너지 × 7% ÷ 9 로 계산.
 * STEP 4: 노란 "주의 영양소" 박스 제거 → VerdictExplanation(줄글)로 교체.
 *         warnings 필드는 응답에 그대로 남아 있지만 화면에서는 쓰지 않는다.
 *
 * 호출하는 컴포넌트:
 *   - frontend/src/components/NutrientRadarChart.tsx
 *   - frontend/src/components/VerdictExplanation.tsx
 */

import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  Search,
  ScanBarcode,
  Camera,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card } from "../components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
// 세로 막대 그래프를 방사형 그래프로 교체했기 때문에 recharts를 여기서 직접 쓰지 않는다
// (차트 관련 import는 NutrientRadarChart.tsx 안으로 옮겨졌다)
import {
  NutrientRadarChart,
  type RadarAxis,
} from "../../components/NutrientRadarChart";
import {
  VerdictExplanation,
  type Reason,
  type CarbInfo,
} from "../../components/VerdictExplanation";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

/**
 * 백엔드 /recommend 응답 타입
 * scoreService.js + recommend.js 반환 구조와 일치해야 함
 */
type AnalysisResult = {
  productName: string;
  userType: string;
  diseaseTrack: "diabetes" | "rule" | "healthy";
  verdict: "추천" | "주의" | "비추천";
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
  allergenAlert: string[];
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

/**
 * GI Category별 카드 스타일 설정
 * giCategory 값으로 바로 조회해서 사용
 */
const GI_CONFIG = {
  Low: {
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    icon: CheckCircle,
    label: "GI 지수 낮음",
    verdict: "추천",
    verdictColor: "text-emerald-600",
    desc: "혈당 영향이 적습니다",
  },
  Medium: {
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-300",
    icon: AlertTriangle,
    label: "GI 지수 중간",
    verdict: "주의",
    verdictColor: "text-amber-600",
    desc: "적당량 섭취를 권장합니다",
  },
  High: {
    color: "text-red-600",
    bg: "bg-red-50",
    border: "border-red-300",
    icon: AlertCircle,
    label: "GI 지수 높음",
    verdict: "비추천",
    verdictColor: "text-red-600",
    desc: "혈당이 빠르게 오를 수 있습니다",
  },
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

  /**
   * 분석 버튼 클릭 또는 Enter 입력 시 실행
   */
  const handleAnalyze = async () => {
    if (!searchQuery.trim()) return;
    setIsAnalyzing(true);
    setShowResults(false);
    setErrorMessage("");

    try {
      const response = await fetch(`${API_URL}/recommend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ foodName: searchQuery, userId: user?.id ?? 1 }),
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
   * [STEP 3] 가로 막대(Progress) 데이터 생성
   *
   * 기준: 한국인 영양소 섭취기준(KDRI), 일반 성인 1일 권장량
   *       → 질병 한도가 아니라 "일반 성인이라면 하루에 이만큼"이라는 값이다.
   *         질병 기준으로 보는 그래프는 위쪽 방사형 그래프가 담당한다.
   *
   * 변경 내용:
   *   - 포화지방 max: 20g 하드코딩 제거 → 에너지 × 7% ÷ 9 로 계산
   *     (KDRI 테이블에 포화지방 항목이 없어서, 백엔드 evaluateHealthy와 똑같은 식을 쓴다.
   *      포화지방 1g = 9kcal 이므로 9로 나눈다)
   *   - 탄수화물 막대 추가: dailyReference.탄수화물은 이제 에너지 × 65% ÷ 4 값이다
   *   - unit을 항목마다 들고 다녀서 "나트륨만 mg" 같은 조건문을 없앴다
   */
  const getNutritionData = (
    nutrition: AnalysisResult["nutrition"],
    dailyReference: AnalysisResult["dailyReference"],
  ) => {
    // 포화지방 1일 기준(g) = 1일 에너지의 7% ÷ 9kcal
    const saturatedFatMax =
      Math.round(((dailyReference.에너지 * 0.07) / 9) * 10) / 10;

    return [
      {
        name: "탄수화물",
        value: nutrition.carbohydrate,
        max: dailyReference.탄수화물,
        unit: "g",
      },
      { name: "당류", value: nutrition.sugar, max: dailyReference.당류, unit: "g" },
      {
        name: "나트륨",
        value: nutrition.sodium,
        max: dailyReference.나트륨,
        unit: "mg",
      },
      {
        name: "포화지방",
        value: nutrition.saturatedFat,
        max: saturatedFatMax,
        unit: "g",
      },
      {
        name: "단백질",
        value: nutrition.protein,
        max: dailyReference.단백질,
        unit: "g",
      },
    ];
  };

  return (
    <div className="min-h-full bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">식품 분석</h1>
          <p className="text-gray-600">
            제품명을 검색하거나 바코드를 스캔하여 분석하세요
          </p>
        </div>

        <Tabs defaultValue="search" className="mb-8">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="search">
              <Search className="w-4 h-4 mr-2" />
              검색
            </TabsTrigger>
            <TabsTrigger value="barcode">
              <ScanBarcode className="w-4 h-4 mr-2" />
              바코드
            </TabsTrigger>
            <TabsTrigger value="ocr">
              <Camera className="w-4 h-4 mr-2" />
              OCR
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-4">
            <Card className="p-6">
              <div className="flex gap-2">
                <Input
                  placeholder="제품명을 입력하세요 (예: 불닭볶음면)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleAnalyze()}
                />
                <Button
                  onClick={handleAnalyze}
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

          <TabsContent value="barcode">
            <Card className="p-12 text-center">
              <ScanBarcode className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600 mb-4">바코드를 스캔하세요</p>
              <Button variant="outline">카메라 열기</Button>
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

        {showResults &&
          analysisResult &&
          (() => {
            const nutritionData = getNutritionData(
              analysisResult.nutrition,
              analysisResult.dailyReference,
            );

            const giConfig = analysisResult.giCategory
              ? GI_CONFIG[analysisResult.giCategory]
              : null;

            return (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* ── 카드 1: 2형 당뇨 → GI 지수 + 판정 ── */}
                {giConfig &&
                  (() => {
                    const GIIcon = giConfig.icon;
                    return (
                      <Card
                        className={`p-6 border-2 ${giConfig.border} ${giConfig.bg}`}
                      >
                        <div className="flex items-center gap-4">
                          <GIIcon className={`w-10 h-10 ${giConfig.color}`} />
                          <div>
                            <p className="text-sm text-gray-500 mb-1">
                              {analysisResult.productName}
                            </p>
                            <h2
                              className={`text-2xl font-bold ${giConfig.verdictColor}`}
                            >
                              {giConfig.verdict}
                            </h2>
                            <p className={`text-sm mt-1 ${giConfig.color}`}>
                              {giConfig.label} — {giConfig.desc}
                            </p>
                          </div>
                        </div>
                      </Card>
                    );
                  })()}

                {/* ── 카드 1-b: 다른 질병 → 판정 라벨만 표시 ── */}
                {!giConfig && analysisResult.verdict && (
                  <Card
                    className={`p-6 border-2 ${
                      analysisResult.verdict === "추천"
                        ? "border-emerald-300 bg-emerald-50"
                        : analysisResult.verdict === "주의"
                          ? "border-amber-300 bg-amber-50"
                          : "border-red-300 bg-red-50"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {analysisResult.verdict === "추천" ? (
                        <CheckCircle className="w-10 h-10 text-emerald-600" />
                      ) : analysisResult.verdict === "주의" ? (
                        <AlertTriangle className="w-10 h-10 text-amber-600" />
                      ) : (
                        <AlertCircle className="w-10 h-10 text-red-600" />
                      )}
                      <div>
                        <p className="text-sm text-gray-500 mb-1">
                          {analysisResult.productName}
                        </p>
                        <h2
                          className={`text-2xl font-bold ${
                            analysisResult.verdict === "추천"
                              ? "text-emerald-600"
                              : analysisResult.verdict === "주의"
                                ? "text-amber-600"
                                : "text-red-600"
                          }`}
                        >
                          {analysisResult.verdict}
                        </h2>
                      </div>
                    </div>
                  </Card>
                )}

                {/* ── 카드 2: 판정 근거 (줄글) ──
                    기존 노란 "주의 영양소" 리스트를 없애고 근거 문단으로 교체했다.
                    analysisResult.warnings는 응답에 그대로 남아 있지만 화면에는 쓰지 않는다. */}
                <Card className="p-6">
                  <VerdictExplanation
                    reasons={analysisResult.reasons ?? []}
                    carbInfo={analysisResult.carbInfo}
                  />
                </Card>

                {/* ── 카드 3: 영양소 균형 (방사형 그래프) ──
                    기존 세로 막대 그래프 자리를 대체한다 */}
                <Card className="p-6">
                  <NutrientRadarChart
                    data={analysisResult.radar ?? []}
                    calories={analysisResult.nutrition.calories}
                    isMlTrack={analysisResult.diseaseTrack === "diabetes"}
                  />
                </Card>

                {/* ── 카드 4: 영양 성분 분석 (가로 막대, 일반 기준) ── */}
                <Card className="p-6">
                  <h3 className="font-semibold mb-1 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                    영양 성분 분석
                  </h3>
                  {/* 기준값 출처 표시 — 위 방사형 그래프(내 질병 기준)와 구분되도록 명시 */}
                  <p className="text-xs text-gray-400 mb-4">
                    기준: 한국인 영양소 섭취기준(KDRI), 일반 성인 1일 권장량
                  </p>
                  <div className="space-y-4">
                    {nutritionData.map((item, index) => {
                      // 100g 섭취 시 1일 권장량의 몇 %인지
                      const percent = Math.round((item.value / item.max) * 100);
                      return (
                        <div key={index}>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-medium">
                              {item.name}
                            </span>
                            {/* g과 % 를 함께 표기: 예) 60g / 422g (14%) */}
                            <span className="text-sm text-gray-600">
                              {item.value}
                              {item.unit} / {item.max}
                              {item.unit} ({percent}%)
                            </span>
                          </div>
                          {/* Progress는 100을 넘으면 꽉 찬 상태로 보이므로 값을 100에서 자른다 */}
                          <Progress
                            value={Math.min(percent, 100)}
                            className="h-2"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 mt-4">
                    괄호 안 %는 이 제품을 100g 섭취했을 때 1일 권장량 대비
                    비율입니다.
                  </p>
                </Card>

                {/* ── 카드 5: 알레르기 유발 성분 ── */}
                {analysisResult.allergenAlert !== null &&
                  analysisResult.allergenAlert !== undefined && (
                    <Card className="p-6">
                      <h3 className="font-semibold mb-4 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-amber-600" />
                        알레르기 유발 성분
                      </h3>
                      {analysisResult.allergenAlert.length > 0 ? (
                        <>
                          <p className="text-sm text-red-600 mb-3">
                            이 제품에 알레르기 유발 성분이 포함되어 있습니다.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {analysisResult.allergenAlert.map((a, i) => (
                              <Badge
                                key={i}
                                className="bg-red-100 text-red-700 border border-red-300"
                              >
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                {a}
                              </Badge>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 text-emerald-600">
                          <CheckCircle className="w-5 h-5" />
                          <p className="text-sm font-medium">
                            이 제품에 알레르기 유발 성분이 없습니다.
                          </p>
                        </div>
                      )}
                    </Card>
                  )}
              </div>
            );
          })()}
      </div>
    </div>
  );
}
