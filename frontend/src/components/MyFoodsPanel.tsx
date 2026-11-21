/**
 * MyFoodsPanel.tsx
 *
 * 역할: 프로필 "내 식품" 탭. 관심 식품과 최근 검색한 식품 목록
 *
 * 쓰이는 곳: frontend/src/app/pages/ProfilePage.tsx
 *
 * 화면 구성:
 *   - 관심 식품: 홈 결과 화면의 하트로 추가한 식품. 줄마다 하트 버튼(누르면 빼기)
 *   - 최근 검색한 식품: 홈·분석 화면에서 검색한 식품 최신 20개 (백엔드가 POST /recommend 때 기록). "전체 지우기"
 *   - 식품 이름을 누르면 홈으로 가서 바로 그 식품을 분석한다
 *       식품명 검색: navigate("/", { state: { query } })
 *       사진(라벨) 결과: navigate("/", { state: { label } }) → 저장해 둔 라벨 값으로 지금 프로필 기준 다시 분석
 *   - 사진 결과는 이름 옆에 작은 "사진" 표시, 카테고리 그림이 없으면 카메라 아이콘
 *   - 카테고리 그림이 있으면 이름 왼쪽에 작게
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Heart, Clock, ChevronRight, Camera } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { getCategoryIcon } from "./categoryIcons";
import {
  fetchMyFoods,
  removeFavorite,
  clearRecent,
  type MyFoodItem,
  type MyFoods,
} from "./myFoodsApi";

/** "11월 20일" / 오늘이면 "오늘 14:05" */
function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `오늘 ${hm}` : `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function MyFoodsPanel() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<MyFoods | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchMyFoods(token)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const open = (item: MyFoodItem) =>
    item.source === "label" && item.labelData
      ? navigate("/", { state: { label: item.labelData } })
      : navigate("/", { state: { query: item.name } });

  const handleRemove = async (item: MyFoodItem) => {
    if (!data) return;
    const before = data;
    setData({
      ...data,
      favorites: data.favorites.filter((f) => !(f.name === item.name && f.source === item.source)),
    });
    try {
      await removeFavorite(token, item.name, item.source);
    } catch {
      setData(before);
    }
  };

  const handleClearRecent = async () => {
    if (!data) return;
    const before = data;
    setData({ ...data, recent: [] });
    try {
      await clearRecent(token);
    } catch {
      setData(before);
    }
  };

  if (error) return <p className="text-sm text-red-600 py-6">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500 py-6">불러오는 중...</p>;

  return (
    <div className="space-y-6">
      {/* ── 관심 식품 ── */}
      <section className="bg-white border">
        <h3 className="flex items-center gap-2 font-semibold px-4 py-3 border-b">
          <Heart className="w-5 h-5 text-red-500 fill-red-500" /> 관심 식품
          <span className="text-sm font-normal text-gray-400">{data.favorites.length}</span>
        </h3>
        {data.favorites.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-5">
            아직 관심 식품이 없어요. 검색 결과에서 하트를 눌러 추가하세요.
          </p>
        ) : (
          <ul className="divide-y">
            {data.favorites.map((f) => (
              <FoodRow
                key={`${f.source}:${f.name}`}
                item={f}
                onOpen={open}
                action={
                  <button
                    type="button"
                    onClick={() => handleRemove(f)}
                    aria-label={`${f.name} 관심 식품에서 빼기`}
                    title="관심 식품에서 빼기"
                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100"
                  >
                    <Heart className="w-5 h-5 text-red-500 fill-red-500" />
                  </button>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── 최근 검색한 식품 ── */}
      <section className="bg-white border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="flex items-center gap-2 font-semibold">
            <Clock className="w-5 h-5 text-gray-500" /> 최근 검색한 식품
          </h3>
          {data.recent.length > 0 && (
            <button
              type="button"
              onClick={handleClearRecent}
              className="text-sm text-gray-500 hover:text-gray-800 hover:underline"
            >
              전체 지우기
            </button>
          )}
        </div>
        {data.recent.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-5">아직 검색한 식품이 없어요.</p>
        ) : (
          <ul className="divide-y">
            {data.recent.map((r) => (
              <FoodRow key={`${r.source}:${r.name}`} item={r} onOpen={open} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 식품 한 줄: [그림] 이름 / 중분류 · 날짜  >  (+ 오른쪽 버튼) */
function FoodRow({
  item,
  onOpen,
  action,
}: {
  item: MyFoodItem;
  onOpen: (item: MyFoodItem) => void;
  action?: React.ReactNode;
}) {
  const icon = getCategoryIcon(item.category);
  return (
    <li className="flex items-center gap-2 pr-2">
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        {icon ? (
          <img src={icon} alt="" className="w-9 h-9 shrink-0" />
        ) : item.source === "label" ? (
          // 사진 결과는 카테고리를 모르니 카메라 아이콘
          <span className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-gray-100" aria-hidden>
            <Camera className="w-5 h-5 text-gray-500" />
          </span>
        ) : (
          <span className="w-9 h-9 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="font-medium text-gray-900 truncate">{item.name}</span>
            {item.source === "label" && (
              <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">사진</span>
            )}
          </span>
          <span className="block text-xs text-gray-500">
            {[item.category, formatWhen(item.at)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
      </button>
      {action}
    </li>
  );
}
