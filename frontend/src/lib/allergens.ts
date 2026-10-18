/**
 * allergens.ts — 프로필/가입 화면에서 고를 수 있는 알레르기 항목
 *
 * backend/services/allergenKnowledge.js 의 SELECTABLE_ALLERGENS 와 이름이 같아야
 * 서버가 원재료/파생 원료와 연결할 수 있다. (묶음 항목은 서버가 구성원으로 확장한다)
 */

export type AllergenOption = {
  name: string;
  /** 어떤 원재료까지 연결되는지 (칩 툴팁/설명) */
  hint?: string;
};

export const ALLERGEN_OPTIONS: AllergenOption[] = [
  { name: "우유", hint: "크림·생크림·버터·치즈·분유·유청 등 유제품 원료" },
  { name: "계란", hint: "난백·난황·마요네즈 등 (알류)" },
  { name: "땅콩" },
  { name: "견과류", hint: "호두·잣·아몬드·캐슈넛·피칸·땅콩 등" },
  { name: "대두", hint: "콩·두부·간장·된장·레시틴 등" },
  { name: "밀", hint: "밀가루·빵가루·튀김가루·글루텐 등 (메밀 제외)" },
  { name: "글루텐", hint: "밀·보리·호밀·귀리" },
  { name: "갑각류", hint: "새우·게·가재·랍스터·크릴" },
  { name: "생선", hint: "고등어·연어·참치·멸치·명태·액젓 등" },
  { name: "메밀" },
  { name: "새우" },
  { name: "게" },
  { name: "조개류", hint: "굴·전복·홍합·바지락 등" },
  { name: "고등어" },
  { name: "오징어" },
  { name: "돼지고기" },
  { name: "쇠고기" },
  { name: "닭고기" },
  { name: "복숭아" },
  { name: "토마토" },
  { name: "아황산류", hint: "이산화황 등 보존료" },
  { name: "호두" },
  { name: "잣" },
];

/** 처음부터 보여 주는 항목 수 (나머지는 "더 보기") */
export const PRIMARY_ALLERGEN_COUNT = 9;

export function allergenHint(name: string): string | undefined {
  return ALLERGEN_OPTIONS.find((o) => o.name === name)?.hint;
}
