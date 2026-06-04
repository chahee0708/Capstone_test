/**
 * FoodAnalysisPage.tsx
 *
 * 역할: 음식 이름을 입력받아 백엔드(/recommend)에 분석 요청하고 결과를 표시하는 페이지
 *
 * 표시 구조 (결과가 있을 때):
 *   1. 판정 카드 (추천/주의/비추천)
 *      - 2형 당뇨 사용자: GI 지수 정보 포함
 *      - 다른 질병 사용자: 판정 라벨만 표시
 *   2. 주의 영양소 목록 (warnings 배열이 있을 때만)
 *   3. 영양 성분 분석 차트 (max값이 KDRI 기준값으로 표시됨)
 *   4. 알레르기 유발 성분 카드
 */

import { useState } from "react";
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

/**
 * 백엔드 /recommend 응답 타입
 * scoreService.js + recommend.js 반환 구조와 일치해야 함
 */
type AnalysisResult = {
  productName: string;
  userType: string;
  diseaseTrack: "diabetes" | "rule";
  verdict: "추천" | "주의" | "비추천";
  giCategory: "Low" | "Medium" | "High" | null;
  bmi: string;
  nutrition: {
    sugar: number;
    sodium: number;
    saturatedFat: number;
    protein: number;
  };
  warnings: string[];
  allergenAlert: string[];
  // 성별+나이 기반 KDRI 1일 기준값 (프론트 차트 max값으로 사용)
  // 예: 남성 25세 → { 나트륨: 2300, 당류: 130, 탄수화물: 130, 단백질: 65, 식이섬유: 30 }
  dailyReference: {
    나트륨: number;
    당류: number;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");

  /**
   * 분석 버튼 클릭 또는 Enter 입력 시 실행
   * userId: 1 하드코딩 (로그인 기능 미구현 상태)
   */
  const handleAnalyze = async () => {
    if (!searchQuery.trim()) return;
    setIsAnalyzing(true);
    setShowResults(false);
    setErrorMessage("");

    try {
      const response = await fetch(`${API_URL}/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foodName: searchQuery, userId: 1 }),
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
   * 영양 성분 차트 데이터 생성
   * max값을 KDRI dailyReference에서 가져옴 (하드코딩 제거)
   *
   * 예: 남성 25세라면
   *   당류   max: 130g  (이전: 25g 하드코딩)
   *   나트륨 max: 2300mg (이전: 2000mg 하드코딩)
   *   단백질 max: 65g   (이전: 20g 하드코딩)
   */
  const getNutritionData = (
    nutrition: AnalysisResult["nutrition"],
    dailyReference: AnalysisResult["dailyReference"],
  ) => [
    { name: "당류", value: nutrition.sugar, max: dailyReference.당류 },
    { name: "나트륨", value: nutrition.sodium, max: dailyReference.나트륨 },
    { name: "포화지방", value: nutrition.saturatedFat, max: 20 }, // KDRI에 포화지방 없음 → 임시 고정값
    { name: "단백질", value: nutrition.protein, max: dailyReference.단백질 },
  ];

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
            const chartData = nutritionData.map((item) => ({
              name: item.name,
              value: (item.value / item.max) * 100,
              rawValue: item.value,
              max: item.max,
            }));

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

                {/* ── 카드 2: 주의 영양소 목록 ── */}
                {analysisResult.warnings.length > 0 && (
                  <Card className="p-6">
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                      주의 영양소
                    </h3>
                    <ul className="space-y-2">
                      {analysisResult.warnings.map((w, i) => (
                        <li
                          key={i}
                          className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2"
                        >
                          {w}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {/* ── 카드 3: 영양 성분 분석 ── */}
                <Card className="p-6">
                  <h3 className="font-semibold mb-1 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                    영양 성분 분석
                  </h3>
                  {/* 기준값 출처 표시 */}
                  <p className="text-xs text-gray-400 mb-4">
                    기준: 한국인 영양소 섭취기준(KDRI) 1일 권장량
                  </p>
                  <div className="space-y-4 mb-6">
                    {nutritionData.map((item, index) => (
                      <div key={index}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium">
                            {item.name}
                          </span>
                          <span className="text-sm text-gray-600">
                            {item.value} / {item.max}
                            {item.name === "나트륨" ? "mg" : "g"}
                          </span>
                        </div>
                        <Progress
                          value={(item.value / item.max) * 100}
                          className="h-2"
                        />
                      </div>
                    ))}
                  </div>
                  {/* 막대 차트: 기준 대비 % */}
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            return (
                              <div className="bg-white p-3 border rounded-lg shadow-lg">
                                <p className="font-semibold">{d.name}</p>
                                <p className="text-sm text-gray-600">
                                  {d.rawValue} / {d.max} ({Math.round(d.value)}
                                  %)
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              entry.value > 20
                                ? "#ef4444" // 20%DV 초과 → 빨간색
                                : entry.value > 5
                                  ? "#f59e0b" // 5%DV 초과  → 노란색
                                  : "#10b981" // 5%DV 이하  → 초록색
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                {/* ── 카드 4: 알레르기 유발 성분 ── */}
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
