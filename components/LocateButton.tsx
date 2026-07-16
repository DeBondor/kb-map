"use client";

import { memo } from "react";
import type { GeoStatus } from "@/components/hooks";

interface Props {
  status: GeoStatus;
  onLocate: () => void;
}

function LocateIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" fill={active ? "currentColor" : "none"} stroke="none" />
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

/**
 * Floating "locate me" control, bottom-right (above the desktop zoom control).
 * Reflects the geolocation status: spinner while acquiring, brand tint once the
 * blue dot is live, danger tint if permission was denied.
 */
function LocateButton({ status, onLocate }: Props) {
  const active = status === "active";
  const denied = status === "denied";
  const error = status === "error";
  return (
    <button
      type="button"
      onClick={onLocate}
      aria-label="Pokaż moją lokalizację"
      aria-pressed={active}
      title={
        denied
          ? "Brak zgody na lokalizację — włącz ją w ustawieniach przeglądarki"
          : error
            ? "Lokalizacja niedostępna"
            : active
              ? "Wyłącz lokalizację"
              : "Moja lokalizacja"
      }
      className={`surface no-focus-ring absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] right-3 z-[1000] grid h-11 w-11 place-items-center rounded-full transition-all active:scale-90 md:bottom-[102px] ${
        active
          ? "!bg-primary-dim text-primary"
          : denied || error
            ? "text-danger hover:text-danger"
            : "text-text-mute hover:text-text"
      }`}
    >
      {status === "locating" ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-surface-3 border-t-primary"
          aria-hidden
        />
      ) : (
        <LocateIcon active={active} />
      )}
    </button>
  );
}

export default memo(LocateButton);
