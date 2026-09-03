"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useAnnouncements } from "@/lib/client/announcements";
import {
  BRAND,
  COLOR_AT_STOP,
  COLOR_EARLY,
  COLOR_LATE,
  formatScan,
} from "@/lib/client/format";

export type BaseLayerId = "kb" | "dark";

export type BaseLayer =
  | {
      /** MapLibre GL vector style (OpenFreeMap) — crisp, keyless, like zbiorkom */
      kind: "vector";
      name: string;
      style: string;
      /** optional CSS filter on the basemap canvas to tune brightness/contrast */
      filter?: string;
    }
  | {
      /** classic raster XYZ tiles */
      kind: "raster";
      name: string;
      url: string;
      attribution: string;
    };

const OFM = (style: string) => `https://tiles.openfreemap.org/styles/${style}`;

/* Base map: OpenFreeMap vector tiles — free, keyless and self-hostable, so the
 * map renders entirely on our own stack instead of depending on the upstream
 * kiedyprzyjedzie raster CDN. "liberty" keeps the same light OSM look (grey
 * streets, green parks, blue water, building footprints) the KB tiles had.
 * Other ready styles (re-add their ids to BaseLayerId to expose them):
 *   muted:    { kind: "vector", name: "Przygaszona", style: OFM("positron"),
 *              filter: "brightness(0.82) contrast(1.06) saturate(0.9)" },
 *   graphite: { kind: "vector", name: "Grafit", style: OFM("dark"),
 *              filter: "brightness(1.55) contrast(0.92)" },
 */
export const BASE_LAYERS: Record<BaseLayerId, BaseLayer> = {
  kb: {
    kind: "vector",
    name: "Jasna",
    style: OFM("liberty"),
  },
  dark: {
    kind: "vector",
    name: "Ciemna",
    style: OFM("dark"),
  },
};

/* When the OpenFreeMap style never loads (CDN down, captive portal, offline
 * PWA), MapApp swaps in a classic raster layer so the user never stares at a
 * blank void. Standard OpenStreetMap tiles are used without requiring any API key. */
export const RASTER_FALLBACK: Record<BaseLayerId, { url: string; attribution: string; className?: string }> = {
  kb: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  dark: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    className: "raster-dark-filter",
  },
};

interface Props {
  count: number | null;
  lastScan: number | null;
  scanCount: number | null;
  offline: boolean;
  stopsVisible: boolean;
  onToggleStops: () => void;
  baseLayer: BaseLayerId;
  onBaseLayer: (id: BaseLayerId) => void;
  /** opens the command palette — the bar's "input" is just a trigger */
  onOpenPalette: () => void;
  /** opens the service-announcements sheet ("Utrudnienia") */
  onOpenAnnouncements: () => void;
}

/* ⌘K on Apple hardware, Ctrl K elsewhere (chip is decorative, hidden on touch) */
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-mute">
      <span className="inline-block h-[10px] w-[10px] rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function TopBar({
  count,
  lastScan,
  scanCount,
  offline,
  stopsVisible,
  onToggleStops,
  baseLayer,
  onBaseLayer,
  onOpenPalette,
  onOpenAnnouncements,
}: Props) {
  const [menu, setMenu] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  /* store notifies at most once per 15 min — no extra work in the 5 s cycle */
  const { unseen } = useAnnouncements();

  /* close the menu on outside tap */
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  return (
    <div
      ref={rootRef}
      className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[1002] w-[min(400px,calc(100vw-24px))] md:left-1/2 md:-translate-x-1/2"
    >
      {/* search trigger — the real search lives in the command palette */}
      <div className="surface flex h-12 items-center gap-2.5 rounded-full pl-4 pr-1.5">
        <button
          type="button"
          onClick={() => {
            setMenu(false);
            onOpenPalette();
          }}
          aria-label="Szukaj przystanku lub linii"
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="shrink-0 text-text-faint"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-[14px] text-text-faint">
            <span className="hidden sm:inline">Szukaj przystanku lub linii…</span>
            <span className="sm:hidden">Szukaj…</span>
          </span>
          <kbd className="mr-1 hidden shrink-0 items-center rounded bg-white/8 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-text-faint md:inline-flex">
            {IS_MAC ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-xs font-bold tabular-nums text-text"
          title={offline ? "Brak połączenia" : "Pojazdy online"}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-danger" : "animate-pulse-dot bg-good"}`}
            aria-hidden
          />
          {count ?? "…"}
        </span>
        <button
          type="button"
          aria-label={unseen ? "Utrudnienia w ruchu (nowe komunikaty)" : "Utrudnienia w ruchu"}
          onClick={() => {
            setMenu(false);
            onOpenAnnouncements();
          }}
          className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-mute transition-colors hover:bg-white/8 hover:text-text md:h-9 md:w-9"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
          {unseen && (
            <span
              className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger md:right-1.5 md:top-1.5"
              aria-hidden
            />
          )}
        </button>
        <button
          type="button"
          aria-label="Ustawienia mapy"
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors md:h-9 md:w-9 ${
            menu ? "bg-primary-dim text-primary" : "text-text-mute hover:bg-white/8 hover:text-text"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
            <circle cx="16" cy="8" r="2" />
            <circle cx="8" cy="16" r="2" />
          </svg>
        </button>
      </div>

      {/* settings menu */}
      {menu && (
        <div className="surface mt-2 rounded-2xl p-4 text-[13px] animate-drop">
          {Object.keys(BASE_LAYERS).length > 1 && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">Mapa</p>
              <div className="mt-2 mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Styl mapy">
                {(Object.keys(BASE_LAYERS) as BaseLayerId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={baseLayer === id}
                    onClick={() => onBaseLayer(id)}
                    className={`flex-1 basis-[calc(33.333%-4px)] rounded-full px-2.5 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                      baseLayer === id
                        ? "bg-brand text-on-brand"
                        : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text"
                    }`}
                  >
                    {BASE_LAYERS[id].name}
                  </button>
                ))}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={onToggleStops}
            role="switch"
            aria-checked={stopsVisible}
            className="mt-3 flex w-full items-center justify-between rounded-xl bg-white/4 px-3 py-2.5 transition-colors hover:bg-white/8"
          >
            <span className="text-text">Przystanki na mapie</span>
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                stopsVisible ? "bg-brand" : "bg-white/15"
              }`}
              aria-hidden
            >
              <span
                className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                  stopsVisible ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
          </button>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
            Kolory pojazdów
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs">
            <LegendDot color={BRAND} label="w trasie" />
            <LegendDot color={COLOR_AT_STOP} label="na przystanku" />
            <LegendDot color={COLOR_LATE} label="opóźniony" />
            <LegendDot color={COLOR_EARLY} label="przed czasem" />
          </div>

          <div className="mt-4 border-t border-hairline pt-3 text-[11px] text-text-faint">
            <p>
              Ostatni skan:{" "}
              <span className="tabular-nums text-text-mute">{formatScan(lastScan, scanCount)}</span>
            </p>
            <p className="mt-1">
              GTFS-RT:{" "}
              <a href="/api/gtfs-rt.pb" target="_blank" rel="noopener" className="font-medium text-primary underline-offset-2 hover:underline">
                .pb
              </a>{" "}
              ·{" "}
              <a href="/api/vehicles" target="_blank" rel="noopener" className="font-medium text-primary underline-offset-2 hover:underline">
                JSON
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(TopBar);
