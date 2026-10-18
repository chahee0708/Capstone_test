import { useState } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Badge } from "./ui/badge";
import { ALLERGEN_OPTIONS, PRIMARY_ALLERGEN_COUNT } from "../../lib/allergens";

/**
 * 알레르기 빠른 선택 칩. 자주 쓰는 항목을 먼저 보여 주고 나머지는 "더 보기"로 펼친다.
 * 이미 선택한 항목은 숨긴다.
 */
export function AllergenQuickPick({
  selected,
  onAdd,
}: {
  selected: string[];
  onAdd: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const available = ALLERGEN_OPTIONS.filter((o) => !selected.includes(o.name));
  const primary = available.filter((o) => ALLERGEN_OPTIONS.indexOf(o) < PRIMARY_ALLERGEN_COUNT);
  const rest = available.filter((o) => ALLERGEN_OPTIONS.indexOf(o) >= PRIMARY_ALLERGEN_COUNT);
  const visible = expanded ? [...primary, ...rest] : primary;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {visible.map((o) => (
          <Badge key={o.name} asChild variant="outline" className="cursor-pointer hover:bg-primary-pale">
            <button type="button" aria-label={`${o.name} 추가`} title={o.hint} onClick={() => onAdd(o.name)}>
              <Plus className="w-3 h-3 mr-1" aria-hidden="true" />
              {o.name}
            </button>
          </Badge>
        ))}
      </div>
      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-positive-deep hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              접기 <ChevronUp className="w-4 h-4" aria-hidden="true" />
            </>
          ) : (
            <>
              더 보기 ({rest.length}) <ChevronDown className="w-4 h-4" aria-hidden="true" />
            </>
          )}
        </button>
      )}
      <p className="text-xs text-mute mt-3">
        우유를 선택하면 크림·버터·치즈 같은 유제품 원료도 함께 확인해요. 항목 이름을 길게 누르면(마우스를 올리면) 연결되는
        원료를 볼 수 있어요.
      </p>
    </div>
  );
}
