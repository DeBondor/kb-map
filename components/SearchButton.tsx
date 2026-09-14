"use client";

import { memo } from "react";

interface Props {
  onSearch: () => void;
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

/**
 * Floating search button matching LocateButton styling and placement.
 */
function SearchButton({ onSearch }: Props) {
  return (
    <button
      type="button"
      onClick={onSearch}
      aria-label="Szukaj linii lub przystanku"
      title="Szukaj linii lub przystanku"
      className="surface no-focus-ring absolute top-[calc(4.5rem+env(safe-area-inset-top,0px)+52px)] right-3 z-[1000] grid h-11 w-11 place-items-center rounded-full text-text-mute transition-all hover:text-text active:scale-90 md:top-auto md:bottom-[154px]"
    >
      <SearchIcon />
    </button>
  );
}

export default memo(SearchButton);
