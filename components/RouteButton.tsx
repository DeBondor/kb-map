"use client";

import { memo } from "react";

interface Props {
  onClick: () => void;
}

function RouteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a4.5 4.5 0 0 0 0-9H7a4 4 0 0 1 0-8h11" />
      <polyline points="15 5 18 2 21 5" />
    </svg>
  );
}

/**
 * Floating button for connection search / journey planning.
 * Matches LocateButton and SearchButton positioning and style.
 */
function RouteButton({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Wyszukaj połączenie"
      title="Wyszukaj połączenie"
      className="surface no-focus-ring absolute top-[calc(4.5rem+env(safe-area-inset-top,0px)+104px)] right-3 z-[1000] grid h-11 w-11 place-items-center rounded-full text-text-mute transition-all hover:text-text active:scale-90 md:top-auto md:bottom-[102px]"
    >
      <RouteIcon />
    </button>
  );
}

export default memo(RouteButton);
