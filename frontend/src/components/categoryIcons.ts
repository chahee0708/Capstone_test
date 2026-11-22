/**
 * categoryIcons.ts
 *
 * 역할: 통합 중분류(Food.unified_mid) → 카테고리 그림(svg / png) 주소
 *
 * 쓰이는 곳: VerdictCard.tsx (제품명 옆 그림), MyFoodsPanel.tsx (목록 그림)
 *
 * 이번 변경: png 그림 28개 추가 (양념·음료·유제품·반찬·간편식 등, 기존 svg 가 없던 중분류)
 *   그림은 정사각형이 아니어서 쓰는 쪽에서 object-contain 으로 비율을 지킨다
 *
 * 그림 추가 방법:
 *   1. svg 또는 png(투명 배경) 파일을 frontend/src/assets/category/ 에 영어 이름으로 넣는다 (예: chocolate.svg)
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
// [추가] png 그림
import processedMeat from "../assets/category/processed-meat.png";
import sugar from "../assets/category/sugar.png";
import soySauce from "../assets/category/soy-sauce.png";
import chiliPowder from "../assets/category/chili-powder.png";
import gochujang from "../assets/category/gochujang.png";
import laver from "../assets/category/laver.png";
import kimchi from "../assets/category/kimchi.png";
import greenTea from "../assets/category/green-tea.png";
import doenjang from "../assets/category/doenjang.png";
import soyMilk from "../assets/category/soy-milk.png";
import tteokbokki from "../assets/category/tteokbokki.png";
import ramen from "../assets/category/ramen.png";
import mayonnaise from "../assets/category/mayonnaise.png";
import flour from "../assets/category/flour.png";
import sandwich from "../assets/category/sandwich.png";
import salt from "../assets/category/salt.png";
import cookingOil from "../assets/category/cooking-oil.png";
import vinegar from "../assets/category/vinegar.png";
import ssamjang from "../assets/category/ssamjang.png";
import orangeJuice from "../assets/category/orange-juice.png";
import yogurt from "../assets/category/yogurt.png";
import milk from "../assets/category/milk.png";
import jerky from "../assets/category/jerky.png";
import sportsDrink from "../assets/category/sports-drink.png";
import coffee from "../assets/category/coffee.png";
import ketchup from "../assets/category/ketchup.png";
import pickle from "../assets/category/pickle.png";
import redGinsengDrink from "../assets/category/red-ginseng-drink.png";

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
  // [추가] png 그림 (괄호: 원래 그림 이름)
  "햄·가공육": processedMeat,
  "당류·시럽": sugar, // 각설탕
  간장: soySauce,
  고춧가루: chiliPowder,
  고추장: gochujang,
  김: laver,
  김치: kimchi,
  "차·전통음료": greenTea, // 녹차
  된장: doenjang,
  두유: soyMilk,
  "떡볶이·분식": tteokbokki,
  라면: ramen,
  마요네즈: mayonnaise,
  "밀가루·전분": flour,
  "샐러드·샌드위치": sandwich,
  소금: salt,
  "식용유·유지": cookingOil,
  식초: vinegar,
  "쌈장·혼합장": ssamjang,
  "과일·야채음료": orangeJuice, // 오렌지주스
  "요거트·요구르트": yogurt,
  우유: milk,
  "건어물·육포": jerky,
  스포츠음료: sportsDrink, // 이온음료
  커피: coffee,
  토마토케첩: ketchup,
  "절임·장아찌": pickle, // 피클
  "홍삼·건강음료": redGinsengDrink,
};

export function getCategoryIcon(category: string | null | undefined): string | null {
  return (category && CATEGORY_ICONS[category]) || null;
}
