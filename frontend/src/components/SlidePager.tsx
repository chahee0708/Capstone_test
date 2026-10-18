/**
 * SlidePager.tsx
 *
 * 역할: 여러 페이지를 한 자리에서 넘겨 보는 공용 슬라이드 틀.
 *       제목 줄(페이지 제목 + 추가 요소 + 오른쪽 끝 ‹ 1 / 2 › 버튼), 페이지 영역, 아래 점을 그린다.
 *   - 좌우 스와이프: 가로 50px 이상 + 세로보다 가로 이동이 클 때만 (세로 스크롤 방해 안 함)
 *   - 높이 고정: 모든 페이지를 같은 grid 칸에 겹쳐 두고 안 보이는 쪽은 visibility 만 숨김
 *     → 높이가 항상 가장 높은 페이지에 맞춰져 넘길 때 들썩이지 않는다
 *   - 페이지가 1개면 버튼·페이지 번호·점을 그리지 않고 스와이프도 하지 않는다
 *   - page / onPageChange 를 넘기면 바깥에서 페이지를 바꿀 수 있다 (예: 알레르기 배지 클릭 → 2페이지)
 *
 * 이번에 바뀐 점 (새 파일):
 *   NutritionSlideCard.tsx 안에 있던 슬라이드 동작을 판정 카드에서도 쓰려고 공용 컴포넌트로 분리했다.
 *
 * 쓰이는 곳:
 *   - frontend/src/components/NutritionSlideCard.tsx (영양소 균형 / 영양성분 분석)
 *   - frontend/src/components/VerdictCard.tsx (판정 근거 / 알레르기 유발 성분)
 */

import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// 좌우 스와이프로 인정하는 최소 가로 이동 거리(px)
const SWIPE_MIN_X = 50;

export type SlidePage = {
  key: string;
  /** 제목 줄에 보일 페이지 제목 (아이콘 포함 가능) */
  title: ReactNode;
  /** 페이지 내용 */
  content: ReactNode;
};

type Props = {
  pages: SlidePage[];
  /** 제목 바로 옆에 붙는 공통 요소 (예: kcal 배지) */
  headerExtra?: ReactNode;
  /** 제목 줄 아래 여백 클래스 */
  headerClassName?: string;
  /** 바깥에서 페이지를 제어할 때 (0부터) */
  page?: number;
  onPageChange?: (page: number) => void;
  /** 제목 줄 + 페이지 영역을 감쌀 틀 (예: Card). 점은 이 틀 바깥 아래에 그려진다 */
  frame?: (inner: ReactNode) => ReactNode;
};

export function SlidePager({
  pages,
  headerExtra,
  headerClassName = "mb-1",
  page: controlledPage,
  onPageChange,
  frame = (inner) => inner,
}: Props) {
  // ── 현재 페이지: 바깥에서 넘겨주면 그 값, 아니면 내부 상태 ──
  const [innerPage, setInnerPage] = useState(0);
  const lastPage = pages.length - 1;
  const page = Math.min(controlledPage ?? innerPage, lastPage);
  const setPage = (p: number) => {
    const next = Math.max(0, Math.min(p, lastPage));
    if (onPageChange) onPageChange(next);
    if (controlledPage === undefined) setInnerPage(next);
  };
  const multi = pages.length > 1;

  // ── 터치 스와이프 ──────────────────────────────────────────
  // 손가락을 댄 위치를 기억했다가 뗄 때 이동 거리로 판단. preventDefault 를 쓰지 않아 세로 스크롤은 그대로
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || !multi) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) <= Math.abs(dy)) return;
    setPage(dx < 0 ? page + 1 : page - 1); // 왼쪽으로 밀면 다음, 오른쪽으로 밀면 이전
  };

  const navButton =
    "inline-flex items-center justify-center w-8 h-8 rounded-full text-gray-600 hover:bg-black/5 disabled:opacity-30 disabled:pointer-events-none";

  const inner = (
    <>
      {/* ── 제목 줄: 페이지 제목 + 공통 요소 + 오른쪽 끝 ‹ 1 / 2 › ── */}
      <div className={`flex items-center gap-2 ${headerClassName}`}>
        <h3 className="font-semibold flex items-center gap-2">{pages[page]?.title}</h3>
        {headerExtra}
        {multi && (
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button type="button" aria-label="이전" className={navButton} onClick={() => setPage(page - 1)} disabled={page === 0}>
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-xs text-gray-500 tabular-nums" aria-live="polite">
              {page + 1} / {pages.length}
            </span>
            <button type="button" aria-label="다음" className={navButton} onClick={() => setPage(page + 1)} disabled={page === lastPage}>
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* ── 페이지 영역: 같은 칸에 겹쳐서 높이를 가장 높은 페이지에 고정 ──
          touch-action: pan-y → 세로 스크롤은 브라우저, 가로 이동은 스와이프 처리 */}
      <div
        className="grid"
        style={multi ? { touchAction: "pan-y" } : undefined}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {pages.map((p, i) => (
          <div
            key={p.key}
            style={{ gridArea: "1 / 1" }}
            className={`transition-opacity duration-300 ${
              i === page ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none"
            }`}
            aria-hidden={i !== page}
          >
            {p.content}
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div>
      {frame(inner)}

      {/* ── 아래 가운데 점: 현재 페이지 점은 길게 (페이지가 1개면 숨김) ── */}
      {multi && (
        <div className="flex justify-center gap-1.5 mt-3">
          {pages.map((p, i) => (
            <button
              key={p.key}
              type="button"
              aria-label={`${i + 1}페이지`}
              aria-current={i === page ? "true" : undefined}
              onClick={() => setPage(i)}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === page ? "w-6 bg-emerald-600" : "w-2 bg-gray-300"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
