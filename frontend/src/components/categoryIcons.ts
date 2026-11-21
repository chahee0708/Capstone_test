/**
 * categoryIcons.ts
 *
 * 역할: 통합 중분류(Food.unified_mid) → 카테고리 그림(svg) 주소
 *
 * 쓰이는 곳: frontend/src/components/NutritionFactsCard.tsx (제품명 옆 그림)
 *
 * 그림 추가 방법:
 *   1. svg 파일을 frontend/src/assets/category/ 에 영어 이름으로 넣는다 (예: chocolate.svg)
 *   2. 아래에 import 한 줄, CATEGORY_ICONS 에 "중분류 이름": 변수 한 줄 추가
 *   중분류 이름은 data_pipeline/clean/category_map.csv 의 unified_mid 와 글자까지 같아야 한다
 *   그림이 없는 중분류는 그림 칸이 아예 나오지 않는다
 */
import burger from "../assets/category/burger.svg";
import cake from "../assets/category/cake.svg";
import candy from "../assets/category/candy.svg";
import cereal from "../assets/category/cereal.svg";
import cheese from "../assets/category/cheese.svg";
import chocolate from "../assets/category/chocolate.svg";
import bread from "../assets/category/bread.svg";
import icecream from "../assets/category/icecream.svg";
import jam from "../assets/category/jam.svg";
import jelly from "../assets/category/jelly.svg";
import snack from "../assets/category/snack.svg";
import soda from "../assets/category/soda.svg";

export const CATEGORY_ICONS: Record<string, string> = {
  과자: snack,
  "잼·스프레드": jam,
  "사탕·캔디": candy,
  시리얼: cereal,
  아이스크림: icecream,
  젤리: jelly,
  초콜릿: chocolate,
  치즈: cheese,
  // 파일 이름은 컵케이크지만 그림은 식빵 → 빵 두 칸에 같이 쓴다
  간식빵: bread,
  "식빵·모닝빵": bread,
  "케이크·디저트": cake,
  탄산음료: soda, // 콜라 그림
  "피자·버거": burger, // 햄버거 그림
};

export function getCategoryIcon(category: string | null | undefined): string | null {
  return (category && CATEGORY_ICONS[category]) || null;
}
