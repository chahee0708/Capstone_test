/**
 * HomePage.tsx
 *
 * 역할: 로그인 후 첫 화면
 *
 * 화면 구성 (브랜드색 배경, 가운데보다 조금 위):
 *   - 문구 "Before you bite, / SafeBite!" (두 번째 줄을 크고 굵게)
 *   - 식품명 검색창 + 오른쪽 카메라 버튼
 *       자동완성: 0.3초 뒤 후보 목록 (useFoodSuggestions). ↑↓ 로 고르고 Enter, 또는 누르면 바로 검색
 *       검색: 이 화면에서 바로 POST /recommend → 문구·검색창이 위로 올라가 작아지고 아래에 결과 카드
 *             (분석 페이지로 넘어가지 않는다. 결과 카드는 분석 페이지와 같은 NutritionFactsCard)
 *       카메라: 사진 고르기 창을 연다. 휴대폰에서는 "사진 촬영" / "사진 보관함" 중 고를 수 있다
 *               (capture 속성을 넣지 않아야 둘 다 나온다)
 *               고른 사진은 이 화면 아래에서 바로 읽는다 (LabelPhotoReview: 읽기 → 값 확인·수정 → 분석)
 *               분석이 끝나면 검색과 같은 결과 카드로 바뀐다
 *   - 상단바·휴대폰 아래 메뉴는 RootLayout 에 있어서 그대로 보인다
 *
 * 쓰이는 곳: routes.ts 의 "/" (index) 경로
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Search, Camera, AlertCircle, ArrowLeft, Heart } from "lucide-react";
import {
  fetchMyFoods,
  addFavorite,
  removeFavorite,
  favoriteKey,
  type LabelInput,
} from "../../components/myFoodsApi";
import { AlternativeCards } from "../../components/AlternativeCards";
import { getCategoryIcon } from "../../components/categoryIcons";
import { useAuth } from "../../contexts/AuthContext";
import { useFoodSuggestions } from "../../components/useFoodSuggestions";
import { NutritionFactsCard } from "../../components/NutritionFactsCard";
import { LabelPhotoReview } from "../../components/LabelPhotoReview";
import { verdictCardFor } from "../../components/VerdictSummaryCard";
import type { AnalysisResult } from "./FoodAnalysisPage";

const API_URL = import.meta.env.VITE_API_URL || "/api";

// Pretendard 를 넣기 전 앱 글꼴 (Tailwind 기본 sans). 홈 문구 "Before you bite, SafeBite!" 에만 쓴다
const OLD_FONT =
  "ui-sans-serif, system-ui, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Noto Color Emoji\"";

/** "로" / "으로": 받침이 없거나 ㄹ 받침이면 "로", 그 밖의 받침이면 "으로" (메로나로, 신라면으로, 우유로) */
function withRo(word: string) {
  const code = word.trim().charCodeAt(word.trim().length - 1) - 0xac00;
  if (code < 0 || code > 11171) return "로"; // 한글이 아니면 "로"
  const jong = code % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

export function HomePage() {
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 자동완성 후보 + 화살표 키로 고른 위치 (-1 = 고르지 않음)
  const { suggestions, update, clear } = useFoodSuggestions();
  const [activeIndex, setActiveIndex] = useState(-1);

  // 검색 결과 (홈 화면 아래에 바로 보여준다)
  const { user, token } = useAuth();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  // 카메라로 고른 사진 (있으면 결과 자리에 "읽은 값 확인" 칸을 보여준다)
  const [labelFile, setLabelFile] = useState<File | null>(null);
  const hasResult = result !== null || isAnalyzing || errorMessage !== "" || labelFile !== null;

  // 대체식품 카드로 넘어왔을 때 원래 제품 이름 ("← 메로나로 돌아가기" 용). 일반 검색이면 null
  const [previousName, setPreviousName] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // 관심 식품 키 목록 ("db:초코파이", "label:연세우유…" — 결과 제품명 옆 하트가 채워졌는지 판단). 처음 한 번 불러온다
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetchMyFoods(token)
      .then((data) => setFavoriteKeys(new Set(data.favorites.map((f) => favoriteKey(f.source, f.name)))))
      .catch(() => {}); // 못 불러와도 검색은 되게 (하트만 빈 채로)
  }, [token]);

  /**
   * 하트: 관심 식품에 넣기/빼기. 화면은 바로 바꾸고, 실패하면 되돌린다
   * labelInput 이 있으면 사진(라벨) 결과 → 다시 분석할 값과 함께 저장
   */
  const toggleFavorite = async (name: string, category: string | null | undefined, labelInput?: LabelInput | null) => {
    const source = labelInput ? "label" : "db";
    const key = favoriteKey(source, name);
    const wasFavorite = favoriteKeys.has(key);
    const next = new Set(favoriteKeys);
    if (wasFavorite) next.delete(key);
    else next.add(key);
    setFavoriteKeys(next);
    try {
      if (wasFavorite) await removeFavorite(token, name, source);
      else await addFavorite(token, name, category ?? null, labelInput ?? null);
    } catch {
      setFavoriteKeys(favoriteKeys);
    }
  };

  // 프로필 "내 식품" 에서 식품을 눌러 넘어온 경우 바로 분석. 새로고침 때 다시 하지 않게 state 를 지운다
  //   { query }: 식품명 검색 / { label }: 사진(라벨) 결과 → 저장해 둔 값으로 다시 분석
  const location = useLocation();
  const navigate = useNavigate();
  const handledStateRef = useRef(false);
  useEffect(() => {
    if (handledStateRef.current) return;
    const state = location.state as { query?: string; label?: LabelInput } | null;
    if (!state?.query && !state?.label) return;
    handledStateRef.current = true;
    navigate(location.pathname, { replace: true, state: null });
    if (state.label) handleLabelAgain(state.label);
    else if (state.query) handleSearch(state.query);
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // [추가] 상단 SafeBite 로고나 휴대폰 아래 "홈" 을 누르면 ({ resetHome }) 처음 검색 화면으로 되돌린다
  //        이미 홈에 있어도 동작하도록 location.key(누를 때마다 바뀜)를 본다
  useEffect(() => {
    const state = location.state as { resetHome?: boolean } | null;
    if (!state?.resetHome) return;
    clear();
    setQuery("");
    setResult(null);
    setErrorMessage("");
    setLabelFile(null);
    setPreviousName(null);
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  /**
   * 검색: POST /recommend 로 분석해서 이 화면 아래에 결과를 보여준다. 후보를 누르면 그 이름으로
   * fromName: 대체식품 카드에서 넘어온 경우 원래 제품 이름 (돌아가기 링크에 쓴다)
   */
  const handleSearch = async (picked?: string, fromName: string | null = null) => {
    const name = (picked ?? query).trim();
    if (!name) return;
    clear();
    setQuery(name);
    setPreviousName(fromName);
    setLabelFile(null); // 사진 확인 중이었다면 닫는다
    setIsAnalyzing(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${API_URL}/recommend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ foodName: name, userId: user?.id ?? 1 }),
      });
      const data = await response.json();
      if (!response.ok) {
        setResult(null);
        setErrorMessage(data.message || "음식을 찾을 수 없습니다.");
        return;
      }
      setResult(data);
    } catch {
      setResult(null);
      setErrorMessage("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * [추가] 저장해 둔 사진(라벨) 값으로 다시 분석: POST /recommend/label
   *   사진을 다시 찍지 않아도 지금의 건강 프로필로 다시 판정한다
   */
  const handleLabelAgain = async (label: LabelInput) => {
    clear();
    setQuery("");
    setPreviousName(null);
    setLabelFile(null);
    setIsAnalyzing(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${API_URL}/recommend/label`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ userId: user?.id ?? 1, ...label }),
      });
      const data = await response.json();
      if (!response.ok) {
        setResult(null);
        setErrorMessage(data.message || "분석에 실패했습니다.");
        return;
      }
      setResult(data);
    } catch {
      setResult(null);
      setErrorMessage("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  /** 대체식품 카드·돌아가기를 눌렀을 때: 그 제품으로 다시 분석하고, 새 결과가 나오면 결과 맨 위로 */
  const scrollOnResultRef = useRef(false);
  const handleSelectAlternative = (name: string) => {
    scrollOnResultRef.current = true;
    handleSearch(name, result?.productName ?? null);
  };
  useEffect(() => {
    if (!scrollOnResultRef.current || !result) return;
    scrollOnResultRef.current = false;
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  /** 사진을 골랐을 때: 이 화면 아래에서 라벨 읽기 → 확인 → 분석 (LabelPhotoReview) */
  const handleFile = (file: File | undefined) => {
    // 같은 사진을 다시 골라도 동작하도록 선택을 비운다
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    clear();
    setPreviousName(null);
    setResult(null);
    setErrorMessage("");
    setLabelFile(file);
  };

  return (
    // 검색 전: 문구+검색창을 가운데보다 조금 위에 (pb 를 pt 보다 크게)
    // 검색 후: 위로 붙이고 문구를 작게 → 아래에 결과
    // 바깥: 초록 배경 전체 (내용 영역 + 맨 아래 저작권 표시)
    <div className="flex-1 bg-[#388E3C] flex flex-col items-center px-4">
    <div
      className={`flex-1 w-full flex flex-col items-center transition-all ${
        hasResult ? "justify-start pt-8 pb-10" : "justify-center pt-10 pb-24"
      }`}
    >
      <div className="w-full max-w-xl">
        {/* 이 문구만 Pretendard 대신 예전 글꼴(기기 기본 글꼴, Tailwind 기본 묶음) */}
        <h1
          className={`text-center text-white leading-tight transition-all ${hasResult ? "mb-5" : "mb-10"}`}
          style={{ fontFamily: OLD_FONT }}
        >
          <span
            className={`block font-normal ${hasResult ? "text-lg md:text-xl" : "text-2xl md:text-4xl"}`}
          >
            Before you bite,
          </span>
          <span
            className={`block font-bold tracking-tight ${
              hasResult ? "text-2xl md:text-3xl mt-1" : "text-4xl md:text-6xl mt-2"
            }`}
          >
            SafeBite!
          </span>
        </h1>

        {/* 검색창 + 카메라 버튼 (+ 아래 자동완성 목록) */}
        <div className="relative">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            // 목록에서 화살표로 고른 후보가 있으면 그 이름으로
            handleSearch(activeIndex >= 0 ? suggestions[activeIndex] : undefined);
          }}
          className="flex items-center gap-2 bg-white rounded-full shadow-lg pl-5 pr-1.5 py-1.5"
        >
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
              update(e.target.value);
            }}
            onKeyDown={(e) => {
              // ↑↓ 로 후보 이동, Esc 로 목록 닫기
              // 한글 조합 중(글자가 아직 완성되지 않음)에 누른 키는 조합을 끝내는 데 쓰이므로 무시
              if (e.nativeEvent.isComposing || suggestions.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % suggestions.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
              } else if (e.key === "Escape") {
                clear();
                setActiveIndex(-1);
              }
            }}
            onBlur={() => {
              clear();
              setActiveIndex(-1);
            }}
            aria-label="식품명 검색"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="home-suggestions"
            aria-autocomplete="list"
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-base text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          <button
            type="submit"
            aria-label="검색"
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-gray-100 text-gray-500 hover:bg-gray-200"
          >
            <Search className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="영양성분표 사진 촬영 또는 올리기"
            title="사진 촬영 / 올리기"
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-gray-100 text-gray-500 hover:bg-gray-200"
          >
            <Camera className="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </form>

        {/* 자동완성 목록: 누르면 바로 검색 */}
        {suggestions.length > 0 && (
          <ul
            id="home-suggestions"
            role="listbox"
            className="absolute left-0 right-0 top-full mt-2 z-20 bg-white shadow-lg py-2 max-h-72 overflow-y-auto"
          >
            {suggestions.map((name, i) => (
              <li key={name} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  // onClick 대신 onMouseDown: 입력칸 onBlur(목록 닫기)보다 먼저 실행되게
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSearch(name);
                  }}
                  className={`w-full text-left px-5 py-2.5 text-sm text-gray-800 hover:bg-gray-100 ${
                    i === activeIndex ? "bg-gray-100" : ""
                  }`}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>

      {/* ── 검색 결과: 연회색 판 위에 분석 화면과 같은 카드 ── */}
      {hasResult && (
        <div
          ref={resultsRef}
          className="w-full max-w-4xl mt-8 bg-gray-50 p-3 md:p-6 scroll-mt-20"
          aria-live="polite"
        >
          {/* 대체식품에서 넘어왔으면 원래 제품으로 돌아가는 링크 */}
          {previousName && !isAnalyzing && (
            <button
              type="button"
              onClick={() => {
                scrollOnResultRef.current = true;
                handleSearch(previousName);
              }}
              className="flex items-center gap-1 text-sm font-medium text-[#388E3C] hover:underline mb-3 px-1"
            >
              <ArrowLeft className="w-4 h-4" />
              {previousName}
              {withRo(previousName)} 돌아가기
            </button>
          )}
          {/* 사진: 읽기 → 값 확인·수정 → 분석. 분석이 끝나면 결과 카드로 바뀐다 */}
          {labelFile && !result && (
            <LabelPhotoReview
              // 새 사진을 고를 때마다 처음부터 다시 읽게
              key={`${labelFile.name}-${labelFile.size}-${labelFile.lastModified}`}
              file={labelFile}
              onResult={(data) => {
                // 긴 확인 칸이 결과로 바뀌면 화면이 중간에 머물러서, 결과 맨 위(판정 카드)로 올린다
                scrollOnResultRef.current = true;
                setResult(data);
                setLabelFile(null);
              }}
            />
          )}
          {isAnalyzing && <p className="text-center text-gray-500 py-10">분석 중...</p>}
          {!isAnalyzing && errorMessage && (
            <p className="flex items-center justify-center gap-2 text-red-600 py-10">
              <AlertCircle className="w-4 h-4" />
              {errorMessage}
            </p>
          )}
          {!isAnalyzing && !errorMessage && result && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <NutritionFactsCard
                key={result.productName}
                productName={result.productName}
                nutrition={result.nutrition}
                ingredients={result.ingredients ?? []}
                unit={result.unit ?? "g"}
                category={result.category}
                serving={result.serving}
                allergens={result.foodAllergens ?? []}
                myAllergens={result.allergens ?? result.allergenAlert ?? []}
                dailyValues={result.dailyValues}
                reasons={result.reasons ?? []}
                headerAction={
                  // 관심 식품 하트: 식품명 검색 결과 + 사진(라벨) 결과 모두. 사진 결과는 다시 분석할 값(labelInput)과 함께 저장
                  (() => {
                    const labelInput = result.source === "ocr" ? result.labelInput ?? null : null;
                    if (result.source === "ocr" && !labelInput) return null; // 예전 응답 대비
                    const isFav = favoriteKeys.has(favoriteKey(labelInput ? "label" : "db", result.productName));
                    return (
                      <button
                        type="button"
                        onClick={() => toggleFavorite(result.productName, result.category, labelInput)}
                        aria-pressed={isFav}
                        aria-label={isFav ? "관심 식품에서 빼기" : "관심 식품에 추가"}
                        title={isFav ? "관심 식품에서 빼기" : "관심 식품에 추가"}
                        className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-gray-100"
                      >
                        <Heart className={`w-6 h-6 ${isFav ? "fill-red-500 text-red-500" : "text-gray-400"}`} />
                      </button>
                    );
                  })()
                }
                verdictCard={
                  <>
                    {verdictCardFor(result)}
                    {/* 대체식품: 주의·비추천일 때만 응답에 alternatives 가 온다 */}
                    {Array.isArray(result.alternatives) && (
                      <AlternativeCards
                        alternatives={result.alternatives}
                        icon={getCategoryIcon(result.category)}
                        onSelect={handleSelectAlternative}
                      />
                    )}
                  </>
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
      {/* 맨 아래 저작권 표시 (로그인·회원가입과 같은 문구) */}
      <footer className="py-6 text-xs text-white/70">© 2026 SafeBite</footer>
    </div>
  );
}
