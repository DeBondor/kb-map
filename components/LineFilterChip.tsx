"use client";

/** Pill under the TopBar showing the active line filter — which lines are on
 *  and how many vehicles survive the filter. Tapping the body reopens the
 *  palette (to tweak lines), the ✕ clears the filter. */
import { memo } from "react";
import { LineBadge } from "@/components/ui";
import { wozPlural } from "@/lib/client/format";

interface Props {
  lines: string[];
  visibleCount: number;
  onClear: () => void;
  onOpenPalette: () => void;
}

function LineFilterChip({ lines, visibleCount, onClear, onOpenPalette }: Props) {
  return (
    <div className="absolute left-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem+56px)] z-[1001] max-w-[calc(100vw-24px)] md:left-1/2 md:-translate-x-1/2 animate-drop">
      <div className="surface flex items-center gap-1 rounded-full py-1 pl-1.5 pr-1">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Zmień filtr linii"
          className="flex min-w-0 items-center gap-1.5 rounded-full px-1 py-0.5 transition-all hover:bg-white/5 active:scale-[0.98]"
        >
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {lines.map((l) => (
              <LineBadge key={l} line={l} />
            ))}
          </span>
          <span className="shrink-0 pr-1 text-[12px] tabular-nums text-text-mute">
            {visibleCount} {wozPlural(visibleCount)}
          </span>
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Wyczyść filtr linii"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-mute transition-all hover:bg-white/8 hover:text-text active:scale-90"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default memo(LineFilterChip);
