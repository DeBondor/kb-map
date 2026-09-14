"use client";

import { memo } from "react";

interface Props {
  text: string;
  /** optional action pill (e.g. "Odśwież") */
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
}

/** Small floating notification under the TopBar. Presentational only — the
 *  owner decides persistence (PwaRegister: sticky; MapApp: 6 s auto-clear). */
function Toast({ text, actionLabel, onAction, onClose }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="surface fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+0.75rem+60px)] z-[1100] flex w-max max-w-[min(400px,calc(100vw-24px))] -translate-x-1/2 items-center gap-2.5 rounded-full py-2 pl-4 pr-2 text-[13px] text-text animate-drop"
    >
      <span className="min-w-0 flex-1">{text}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand transition-transform active:scale-95"
        >
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        aria-label="Zamknij powiadomienie"
        onClick={onClose}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-mute transition-colors hover:bg-white/8 hover:text-text"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

export default memo(Toast);
