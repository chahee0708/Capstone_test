/**
 * myFoodsApi.ts
 *
 * 역할: 관심 식품 / 최근 검색 API 호출 모음 (backend/routes/myFoods.js)
 *
 * 쓰이는 곳: HomePage.tsx (하트 버튼), ProfilePage.tsx (내 식품 탭)
 */
const API_URL = import.meta.env.VITE_API_URL || "/api";

export type MyFoodItem = {
  name: string;
  category: string | null;
  at: string; // 추가/검색한 시각 (ISO)
};

export type MyFoods = { favorites: MyFoodItem[]; recent: MyFoodItem[] };

const auth = (token: string | null) => (token ? { Authorization: `Bearer ${token}` } : {});

export async function fetchMyFoods(token: string | null): Promise<MyFoods> {
  const res = await fetch(`${API_URL}/me/foods`, { headers: auth(token) });
  if (!res.ok) throw new Error("내 식품을 불러오지 못했습니다.");
  return res.json();
}

export async function addFavorite(token: string | null, name: string, category: string | null) {
  const res = await fetch(`${API_URL}/me/favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(token) },
    body: JSON.stringify({ name, category }),
  });
  if (!res.ok) throw new Error("관심 식품에 추가하지 못했습니다.");
}

export async function removeFavorite(token: string | null, name: string) {
  const res = await fetch(`${API_URL}/me/favorites/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: auth(token),
  });
  if (!res.ok) throw new Error("관심 식품에서 빼지 못했습니다.");
}

export async function clearRecent(token: string | null) {
  const res = await fetch(`${API_URL}/me/recent`, { method: "DELETE", headers: auth(token) });
  if (!res.ok) throw new Error("최근 검색을 지우지 못했습니다.");
}
