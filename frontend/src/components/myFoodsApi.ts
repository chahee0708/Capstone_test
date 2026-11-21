/**
 * myFoodsApi.ts
 *
 * 역할: 관심 식품 / 최근 검색 API 호출 모음 (backend/routes/myFoods.js)
 *
 * 쓰이는 곳: HomePage.tsx (하트 버튼), ProfilePage.tsx (내 식품 탭)
 */
const API_URL = import.meta.env.VITE_API_URL || "/api";

// [추가] 사진으로 읽은 라벨을 다시 분석할 값 (POST /recommend/label 요청 본문에서 userId 만 뺀 것)
export type LabelInput = {
  productName: string;
  foodType?: string | null; // [추가] 라벨의 식품유형 (예전에 저장한 값에는 없다)
  nutritionPer100g: Record<string, number | null>;
  allergenText: string[];
  mayContain: string[];
  ocrWarnings: string[];
  ingredients: string[];
  basis: { amount: number; unit: string; text: string } | null;
};

export type MyFoodItem = {
  name: string;
  category: string | null;
  source: "db" | "label"; // [추가] 식품명 검색 / 사진(라벨)
  labelData: LabelInput | null; // [추가] 사진 결과면 다시 분석할 값
  at: string; // 추가/검색한 시각 (ISO)
};

export type MyFoods = { favorites: MyFoodItem[]; recent: MyFoodItem[] };

const auth = (token: string | null) => (token ? { Authorization: `Bearer ${token}` } : {});

export async function fetchMyFoods(token: string | null): Promise<MyFoods> {
  const res = await fetch(`${API_URL}/me/foods`, { headers: auth(token) });
  if (!res.ok) throw new Error("내 식품을 불러오지 못했습니다.");
  return res.json();
}

/** 관심 식품 이름 키: 같은 이름이라도 식품명 검색과 사진 결과는 따로 ("db:초코파이", "label:초코파이") */
export const favoriteKey = (source: "db" | "label", name: string) => `${source}:${name}`;

/** 관심 식품 추가. 사진 결과는 labelData 를 같이 넘긴다 (source "label") */
export async function addFavorite(
  token: string | null,
  name: string,
  category: string | null,
  labelData: LabelInput | null = null,
) {
  const res = await fetch(`${API_URL}/me/favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(token) },
    body: JSON.stringify(
      labelData ? { name, category, source: "label", labelData } : { name, category, source: "db" },
    ),
  });
  if (!res.ok) throw new Error("관심 식품에 추가하지 못했습니다.");
}

export async function removeFavorite(token: string | null, name: string, source: "db" | "label" = "db") {
  const res = await fetch(`${API_URL}/me/favorites/${encodeURIComponent(name)}?source=${source}`, {
    method: "DELETE",
    headers: auth(token),
  });
  if (!res.ok) throw new Error("관심 식품에서 빼지 못했습니다.");
}

export async function clearRecent(token: string | null) {
  const res = await fetch(`${API_URL}/me/recent`, { method: "DELETE", headers: auth(token) });
  if (!res.ok) throw new Error("최근 검색을 지우지 못했습니다.");
}
