/**
 * LabelPhotoReview.tsx
 *
 * 역할: 영양성분표 사진 한 장을 받아
 *   1. POST /ocr/label 로 글자를 읽고
 *   2. 읽은 제품명·100g당 영양성분 9개를 고칠 수 있는 칸으로 보여준 뒤 (함유·혼입 가능 문구, OCR 경고도 표시)
 *   3. "이 값으로 분석하기" → POST /recommend/label 결과를 onResult 로 넘긴다
 *
 * 쓰이는 곳: frontend/src/app/pages/HomePage.tsx (카메라 버튼)
 *   분석 페이지(FoodAnalysisPage) OCR 탭과 같은 요청·같은 칸이다. (분석 페이지는 아직 자기 코드 그대로)
 *
 * key={사진} 으로 쓰면 새 사진을 고를 때마다 처음부터 다시 읽는다.
 */
import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { prepareImageForOcr } from "./prepareImageForOcr";
import { Button } from "../app/components/ui/button";
import { Input } from "../app/components/ui/input";
import { Card } from "../app/components/ui/card";
import type { AnalysisResult } from "../app/pages/FoodAnalysisPage";

const API_URL = import.meta.env.VITE_API_URL || "/api";

// 수정 칸에 보여줄 영양성분 9개 (키는 foodService.getFoodNutrition 과 같다)
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

// 영양성분은 고칠 수 있게 문자열로 보관한다
type LabelForm = {
  productName: string;
  nutrition: Record<string, string>;
  ingredients: string[];
  allergenText: string[];
  mayContain: string[];
  warnings: string[];
  // [추가] 라벨의 기준량 (예: { amount: 150, unit: "g", text: "총 내용량(150 g)당" }). 결과 화면 기본 "1개" 양으로 쓴다
  basis: { amount: number; unit: string; text: string } | null;
  foodType: string | null; // [추가] 라벨의 식품유형 (예: "빵류") → 백엔드가 카테고리를 정한다
};

type Props = {
  file: File;
  onResult: (result: AnalysisResult) => void;
};

export function LabelPhotoReview({ file, onResult }: Props) {
  const { user, token } = useAuth();
  const [isReading, setIsReading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [form, setForm] = useState<LabelForm | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // ── 1. 사진 읽기 (사진이 바뀌면 key 로 새로 만들어지므로 처음 한 번만) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("image", await prepareImageForOcr(file)); // 방향 바로잡고 크기 줄여서 (prepareImageForOcr)
        const response = await fetch(`${API_URL}/ocr/label`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        const data = await response.json();
        if (cancelled) return;
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
        setForm({
          productName: data.productName ?? "",
          nutrition,
          ingredients: data.ingredients ?? [],
          allergenText: data.allergenText ?? [],
          mayContain: data.mayContain ?? [],
          warnings: data.warnings ?? [],
          basis: data.basis ?? null,
          foodType: data.foodType ?? null,
        });
      } catch {
        if (!cancelled) setErrorMessage("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
      } finally {
        if (!cancelled) setIsReading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 사진 하나당 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 3. 고친 값으로 분석 ──
  const handleAnalyze = async () => {
    if (!form) return;
    setIsAnalyzing(true);
    setErrorMessage("");

    // 빈 칸은 null 로 보낸다 → 백엔드가 400 으로 막는다
    const nutritionPer100g: Record<string, number | null> = {};
    for (const { key } of LABEL_NUTRIENTS) {
      const value = form.nutrition[key].trim();
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
          productName: form.productName.trim(),
          nutritionPer100g,
          allergenText: form.allergenText,
          mayContain: form.mayContain,
          ocrWarnings: form.warnings,
          ingredients: form.ingredients,
          basis: form.basis, // [추가] 결과 화면의 기본 기준량(1개)으로
          foodType: form.foodType, // [추가] 카테고리용
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(data.message || "분석에 실패했습니다.");
        return;
      }
      onResult(data);
    } catch {
      setErrorMessage("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isReading) {
    return <p className="text-center text-gray-500 py-10">사진에서 영양성분표를 읽는 중...</p>;
  }

  return (
    <div className="space-y-3">
      {/* ── 2. 읽은 값 확인·수정 ── */}
      {form && (
        <Card className="p-5 gap-0 space-y-4 rounded-none">
          <div>
            <h3 className="font-semibold">읽은 내용을 확인해 주세요</h3>
            <p className="text-sm text-gray-500 mt-1">잘못 읽은 숫자는 고친 뒤 분석하세요.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="home-label-name">
              제품명
            </label>
            <Input
              id="home-label-name"
              value={form.productName}
              onChange={(e) => setForm({ ...form, productName: e.target.value })}
            />
          </div>

          <div>
            <p className="text-sm font-medium mb-2">영양성분 (100g당)</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {LABEL_NUTRIENTS.map(({ key, label, unit }) => (
                <div key={key}>
                  <label className="block text-sm text-gray-600 mb-1" htmlFor={`home-label-${key}`}>
                    {label} ({unit})
                  </label>
                  <Input
                    id={`home-label-${key}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={form.nutrition[key]}
                    onChange={(e) =>
                      setForm({ ...form, nutrition: { ...form.nutrition, [key]: e.target.value } })
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="text-sm text-gray-700 space-y-1">
            <p>함유: {form.allergenText.join(", ") || "읽은 문구 없음"}</p>
            <p>혼입 가능: {form.mayContain.join(", ") || "읽은 문구 없음"}</p>
          </div>

          {form.warnings.length > 0 && (
            <ul className="text-sm text-amber-700 list-disc pl-5">
              {form.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          <Button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="w-full bg-[#388E3C] hover:bg-[#1B5E20]"
          >
            {isAnalyzing ? "분석 중..." : "이 값으로 분석하기"}
          </Button>
        </Card>
      )}

      {errorMessage && (
        <p className="flex items-center justify-center gap-2 text-red-600 text-sm py-4">
          <AlertCircle className="w-4 h-4" />
          {errorMessage}
        </p>
      )}
    </div>
  );
}
