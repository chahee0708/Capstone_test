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
 * ── 이번 변경(seohee 브랜치 기능 이식) ─────────────────────────
 *   - [추가] 판정 카드에 카테고리 그림(응답 category → categoryIcons.ts)과 관심 식품 하트 버튼
 *       하트: POST/DELETE /me/favorites. 사진 결과는 labelInput 을 같이 저장 → 프로필에서 다시 분석
 *   - [추가] 원재료 카드 (IngredientsCard, 결과 맨 아래 식품 라벨 모양): 응답 ingredients 의 설명을 말풍선으로
 *   - [추가] 프로필 "내 식품" 에서 들어오면 (location.state) 바로 분석
 *       { query } → 식품명 검색 분석 / { label } → 저장된 라벨 값으로 POST /recommend/label
 *   - [변경] OCR 사진은 보내기 전에 방향·크기 정리 (prepareImageForOcr)
 *   - [변경] POST /recommend/label 에 원재료·기준량·식품유형도 보낸다 (원재료 설명, 카테고리, 다시 분석용)
 *   - [변경] "이 값으로 분석하기" 가 성공하면 확인·수정 칸과 촬영 카드를 숨긴다 → 결과 화면만 보인다 (실패하면 칸 유지)
 *       다른 사진을 분석하려면 검색 탭을 눌렀다가 OCR 탭으로 돌아오면 촬영 카드가 다시 보인다
 *
 * ── 이전 변경(OCR 확인 화면: 기준량 수정 + 100g당 재계산) ──────────
 *   - 영양성분 칸에 사진에 적힌 값(nutritionRaw)을 보여주고, 칸 아래에 100g당 값을 자동 계산해 표시
 *   - 기준량 칸(숫자 + g/ml) 추가. 기준량이나 원본값을 고치면 100g당 값이 바로 다시 계산된다
 *       계산: utils/per100.ts (백엔드 labelParser.js 의 toPer100 과 같은 식)
 *   - 기준량("~당")을 못 읽으면 총 내용량(totalAmount)으로 미리 채우고 확인 안내, 둘 다 없으면 비워 두고 입력 안내
 *   - 기준량이나 영양성분 칸이 하나라도 비면 "이 값으로 분석하기" 버튼 비활성
 *   - POST /recommend/label 로는 지금처럼 nutritionPer100g 를 보낸다 (서버 변경 없음)
 *
 * ── 이전 변경(OCR 탭 연결) ───────────────────────────────────
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
import { Search, Camera, AlertCircle, Heart } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card } from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { isValidBasis, toPer100 } from "../../utils/per100";
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
import { IngredientsCard, type IngredientInfo } from "../../components/IngredientsCard";
import { getCategoryIcon } from "../../components/categoryIcons";
import { prepareImageForOcr } from "../../components/prepareImageForOcr";
import {
  fetchMyFoods,
  addFavorite,
  removeFavorite,
  favoriteKey,
  type LabelInput,
} from "../../components/myFoodsApi";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";//백엔드 로컬호스트 값

/**
 * 백엔드 /recommend 응답 타입
 * scoreService.js + recommend.js 반환 구조와 일치해야 함
 */
type AnalysisResult = {
  productName: string;
  // [추가] 원재료 + 설명 (없으면 []), 통합 중분류 (카테고리 그림용, 없으면 null)
  ingredients?: IngredientInfo[];
  category?: string | null;
  // [추가] 사진 결과에만: 출처 "ocr" + 다시 분석할 값 (관심 식품 저장용)
  source?: "ocr";
  labelInput?: LabelInput;
  userType: string;
  diseaseTrack: "diabetes" | "rule" | "healthy";
  // 최종 판정 (영양 판정 그대로. 알레르기는 등급에 영향을 주지 않는다)
  verdict: "추천" | "주의" | "비추천";
  // 영양 판정 (verdict 와 같은 값. 응답 형식 유지용)
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

// POST /ocr/label 응답 중 이 화면에서 쓰는 값. 숫자 칸은 수정할 수 있게 문자열로 보관한다
type LabelForm = {
  productName: string;
  basisAmount: string; // 기준량 숫자 (못 읽었으면 "")
  basisUnit: "g" | "ml";
  basisSource: "label" | "total" | "none"; // 기준량 출처: "~당" 문구 / 총 내용량 / 없음
  totalText: string; // 총 내용량 문구 (안내 문장용)
  basisText: string; // [추가] 기준량 문구 (예: "1봉지(55 g)당"). 다시 분석용으로 저장
  raw: Record<string, string>; // 사진에 적힌 값 (기준량당)
  allergenText: string[];
  mayContain: string[];
  warnings: string[];
  ingredients: string[]; // [추가] 라벨에서 읽은 원재료 (원재료 설명·알레르기 검사용)
  foodType: string | null; // [추가] 라벨의 식품유형 (카테고리 그림용)
};

/** 문자열 칸 → 0 이상의 숫자. 비었거나 숫자가 아니면 null */
function parseAmount(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** 확인 화면 값으로 100g당 값 계산. 기준량이 없으면 전부 null, 원본값이 빈 칸은 null */
function computePer100(form: LabelForm): Record<string, number | null> {
  const basis = parseAmount(form.basisAmount);
  const result: Record<string, number | null> = {};
  for (const { key } of LABEL_NUTRIENTS) {
    const value = parseAmount(form.raw[key]);
    result[key] =
      basis !== null && isValidBasis(basis) && value !== null ? toPer100(value, basis) : null;
  }
  return result;
}

export function FoodAnalysisPage() {
  const { user, token } = useAuth();
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

  // ── [추가] 관심 식품: "db:이름" / "label:이름" 키 모음 (하트 채움 여부) ──
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!token) return;
    fetchMyFoods(token)
      .then((data) => setFavoriteKeys(new Set(data.favorites.map((f) => favoriteKey(f.source, f.name)))))
      .catch(() => {}); // 목록을 못 불러와도 분석은 된다 (하트만 빈 채로)
  }, [token]);

  // ── [추가] 프로필 "내 식품" 에서 누르고 들어온 경우: 바로 분석 ──
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const state = location.state as { query?: string; label?: LabelInput } | null;
    if (!state) return;
    // 새로고침·뒤로가기로 다시 분석되지 않게 state 를 비운다
    navigate(location.pathname, { replace: true, state: null });
    if (state.label) {
      setSearchQuery("");
      runLabelAnalysis(state.label);
    } else if (state.query) {
      setSearchQuery(state.query);
      handleAnalyze(state.query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

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

  /** 사진 선택 시: POST /ocr/label 로 글자를 읽어 수정 칸을 채운다 */
  const handleLabelFile = async (file: File | undefined) => {
    if (!file) return;
    setIsReadingLabel(true);
    setLabelForm(null);
    setShowResults(false);
    setErrorMessage("");

    try {
      const formData = new FormData();
      // [변경] 휴대폰 사진 방향을 바로잡고 크기를 줄여서 보낸다
      formData.append("image", await prepareImageForOcr(file));
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

      // 사진에 적힌 값을 넣고, 못 읽은 값(null)은 빈 칸으로 둔다 (0 으로 채우지 않는다)
      const raw: Record<string, string> = {};
      for (const { key } of LABEL_NUTRIENTS) {
        const value = data.nutritionRaw?.[key];
        raw[key] = value === null || value === undefined ? "" : String(value);
      }
      // 기준량: "~당" 문구 → 없으면 총 내용량 → 둘 다 없으면 빈 칸
      const basis = data.basis ?? data.totalAmount ?? null;
      setLabelForm({
        productName: data.productName ?? "",
        basisAmount: basis ? String(basis.amount) : "",
        basisUnit: basis?.unit === "ml" ? "ml" : "g",
        basisSource: data.basis ? "label" : data.totalAmount ? "total" : "none",
        totalText: data.totalAmount?.text ?? "",
        basisText: basis?.text ?? "",
        raw,
        allergenText: data.allergenText ?? [],
        mayContain: data.mayContain ?? [],
        warnings: data.warnings ?? [],
        ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
        foodType: data.foodType ?? null,
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
    // 화면에 보이는 100g당 값을 그대로 보낸다 (빈 값이 있으면 버튼이 비활성이라 여기까지 오지 않는다)
    const nutritionPer100g = computePer100(labelForm);
    if (Object.values(nutritionPer100g).some((v) => v === null)) return;

    await runLabelAnalysis({
      productName: labelForm.productName.trim(),
      foodType: labelForm.foodType,
      nutritionPer100g,
      allergenText: labelForm.allergenText,
      mayContain: labelForm.mayContain,
      ocrWarnings: labelForm.warnings,
      ingredients: labelForm.ingredients,
      basis: {
        amount: Number(labelForm.basisAmount),
        unit: labelForm.basisUnit,
        text: labelForm.basisText,
      },
    });
  };

  /**
   * [추가] 라벨 값으로 POST /recommend/label → 결과 화면
   * OCR 확인 화면의 "이 값으로 분석하기"와, 프로필 "내 식품" 의 사진 결과 다시 분석이 같이 쓴다
   */
  const runLabelAnalysis = async (input: LabelInput) => {
    setIsAnalyzing(true);
    setShowResults(false);
    setErrorMessage("");

    try {
      const response = await fetch(`${API_URL}/recommend/label`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ userId: user?.id ?? 1, ...input }),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(data.message || "분석에 실패했습니다.");
        return;
      }
      setAnalysisResult(data);
      setShowResults(true);
      // [추가] 분석이 끝나면 확인·수정 칸을 닫고 결과만 보이게 (맨 위로)
      setLabelForm(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErrorMessage("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  /** [추가] 하트: 관심 식품 추가/빼기. 화면을 먼저 바꾸고 실패하면 되돌린다 */
  const handleToggleFavorite = async (result: AnalysisResult) => {
    const source = result.source === "ocr" ? "label" : "db";
    const key = favoriteKey(source, result.productName);
    const wasFavorite = favoriteKeys.has(key);
    const update = (on: boolean) =>
      setFavoriteKeys((prev) => {
        const next = new Set(prev);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      });
    update(!wasFavorite);
    try {
      if (wasFavorite) await removeFavorite(token, result.productName, source);
      else
        await addFavorite(
          token,
          result.productName,
          result.category ?? null,
          source === "label" ? (result.labelInput ?? null) : null,
        );
    } catch {
      update(wasFavorite);
    }
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

        <Tabs
          defaultValue="search"
          className="mb-8"
          // [추가] 사진 분석 결과·읽은 값을 보다가 탭을 바꾸면 닫는다 → OCR 탭으로 돌아오면 촬영 카드가 다시 보인다
          onValueChange={() => {
            if (analysisResult?.source === "ocr") setShowResults(false);
            setLabelForm(null);
          }}
        >
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
            {/* [변경] 읽은 값 확인 중이거나 사진 분석 결과를 보는 동안은 촬영 카드를 숨긴다 (탭을 바꾸면 다시 보인다) */}
            {!labelForm && !(showResults && analysisResult?.source === "ocr") && (
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
            )}

            {/* 읽은 값 확인·수정 */}
            {labelForm && (() => {
              // 입력할 때마다 다시 계산한다
              const per100 = computePer100(labelForm);
              const basisValue = parseAmount(labelForm.basisAmount);
              const basisMissing = basisValue === null || !isValidBasis(basisValue);
              const rawMissing = LABEL_NUTRIENTS.some(({ key }) => parseAmount(labelForm.raw[key]) === null);

              return (
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

                {/* 기준량: 영양성분표가 몇 g(ml) 기준인지 */}
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="label-basis">
                    기준량
                  </label>
                  <div className="flex gap-2 max-w-xs">
                    <Input
                      id="label-basis"
                      type="number"
                      min="0"
                      step="any"
                      value={labelForm.basisAmount}
                      onChange={(e) => setLabelForm({ ...labelForm, basisAmount: e.target.value })}
                    />
                    <Select
                      value={labelForm.basisUnit}
                      onValueChange={(unit) =>
                        setLabelForm({ ...labelForm, basisUnit: unit as "g" | "ml" })
                      }
                    >
                      <SelectTrigger className="w-24" aria-label="기준량 단위">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="g">g</SelectItem>
                        <SelectItem value="ml">ml</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {basisMissing ? (
                    <p className="text-sm text-amber-700 mt-1">
                      포장지의 총 내용량 또는 1회 제공량을 입력해주세요
                    </p>
                  ) : (
                    labelForm.basisSource === "total" && (
                      <p className="text-sm text-amber-700 mt-1">
                        기준량 문구를 찾지 못해 {labelForm.totalText || "총 내용량"}(으)로 채웠어요.
                        영양성분표가 총 내용량 기준인지 확인해주세요
                      </p>
                    )
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">영양성분 (사진에 적힌 값)</p>
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
                          value={labelForm.raw[key]}
                          onChange={(e) =>
                            setLabelForm({
                              ...labelForm,
                              raw: { ...labelForm.raw, [key]: e.target.value },
                            })
                          }
                        />
                        {/* 100g당 값 (읽기 전용, ml 도 1ml = 1g) */}
                        <p className="text-xs text-gray-500 mt-1">
                          100g당 {per100[key] ?? "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                  {rawMissing && (
                    <p className="text-sm text-amber-700 mt-2">비어 있는 영양성분을 입력해주세요</p>
                  )}
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

                {/* 기준량이나 영양성분 칸이 비면 분석할 수 없다 */}
                <Button
                  onClick={handleAnalyzeLabel}
                  disabled={isAnalyzing || basisMissing || rawMissing}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {isAnalyzing ? "분석 중..." : "이 값으로 분석하기"}
                </Button>
              </Card>
              );
            })()}

            {errorMessage && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {errorMessage}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {showResults && analysisResult && (() => {
          // 걸린 알레르기: 새 필드 allergens, 없으면 예전 필드 allergenAlert
          const allergens =
            analysisResult.allergens ?? analysisResult.allergenAlert ?? [];
          // [추가] 관심 식품 여부 (사진 결과와 검색 결과는 따로)
          const isFavorite = favoriteKeys.has(
            favoriteKey(analysisResult.source === "ocr" ? "label" : "db", analysisResult.productName),
          );

          return (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* ── 1. 판정 카드 (알레르기 배지·결론·성분 상자 포함) ── */}
              {/* key: 제품이 바뀌면 판정 카드 슬라이드도 1페이지부터 */}
              <VerdictCard
                key={`verdict-${analysisResult.productName}`}
                productName={analysisResult.productName}
                verdict={analysisResult.verdict}
                giCategory={analysisResult.giCategory}
                reasons={analysisResult.reasons ?? []}
                carbInfo={analysisResult.carbInfo}
                allergens={allergens}
                allergyUnknown={analysisResult.allergyUnknown ?? false}
                categoryIcon={getCategoryIcon(analysisResult.category)}
                categoryName={analysisResult.category ?? null}
                headerAction={
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite(analysisResult)}
                    aria-label={isFavorite ? "관심 식품에서 빼기" : "관심 식품에 추가"}
                    aria-pressed={isFavorite}
                    title={isFavorite ? "관심 식품에서 빼기" : "관심 식품에 추가"}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/70"
                  >
                    <Heart
                      className={`w-5 h-5 ${isFavorite ? "text-red-500 fill-red-500" : "text-gray-400"}`}
                    />
                  </button>
                }
              />

              {/* ── OCR 결과 안내: 혼입 가능은 함유보다 약한 주의 ── */}
              {(analysisResult.mayContainAlerts?.length ?? 0) > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                  혼입 가능 주의: {analysisResult.mayContainAlerts?.join(", ")}
                </div>
              )}
              {analysisResult.allergyCheckIncomplete && !analysisResult.allergyUnknown && (
                <div className="p-3 bg-gray-100 border border-gray-200 rounded-lg text-gray-600 text-sm">
                  라벨의 알레르기 문구를 모두 확인하지 못했어요. 포장의 원재료를 꼭 확인하세요.
                </div>
              )}

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
                key={`nutrition-${analysisResult.productName}`}
                radar={analysisResult.radar ?? []}
                calories={analysisResult.nutrition.calories}
                isMlTrack={analysisResult.diseaseTrack === "diabetes"}
              />

              {/* ── 4. [변경] 원재료 + 설명 말풍선: 맨 아래, 식품 라벨 모양 ── */}
              {Array.isArray(analysisResult.ingredients) && (
                <IngredientsCard ingredients={analysisResult.ingredients} />
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
