"use client";

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BRAND,
  COLOR_AT_STOP,
  COLOR_EARLY,
  COLOR_LATE,
  delayTxt,
  formatScan,
  normalizeText,
} from "@/lib/client/format";
import { LineBadge } from "@/components/ui";
import type { Stop, Vehicle } from "@/lib/client/types";

export type BaseLayerId = "kb";

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
 * Other ready styles (re-add their ids to BaseLayerId to expose a switcher):
 *   muted:    { kind: "vector", name: "Przygaszona", style: OFM("positron"),
 *              filter: "brightness(0.82) contrast(1.06) saturate(0.9)" },
 *   graphite: { kind: "vector", name: "Grafit", style: OFM("dark"),
 *              filter: "brightness(1.55) contrast(0.92)" },
 *   dark:     { kind: "vector", name: "Ciemna", style: OFM("dark") },
 *   light:    { kind: "vector", name: "Jasna", style: OFM("positron") },
 */
export const BASE_LAYERS: Record<BaseLayerId, BaseLayer> = {
  kb: {
    kind: "vector",
    name: "Mapa",
    style: OFM("liberty"),
  },
};

interface Props {
  count: number | null;
  lastScan: number | null;
  scanCount: number | null;
  offline: boolean;
  stops: Stop[];
  vehicles: Vehicle[];
  stopsVisible: boolean;
  onToggleStops: () => void;
  onPickStop: (s: Stop) => void;
  onPickVehicle: (v: Vehicle) => void;
  baseLayer: BaseLayerId;
  onBaseLayer: (id: BaseLayerId) => void;
}

const MAX_RESULTS = 9;

/** A search hit: either a live line (a running vehicle) or a physical stop. */
type Result = { kind: "veh"; v: Vehicle } | { kind: "stop"; s: Stop };

const resultKey = (r: Result) => (r.kind === "veh" ? `v-${r.v.id}` : `s-${r.s.id}`);

/** Bus glyph, sized to match a LineBadge so rows align. */
function StopMark() {
  return (
    <span
      className="grid h-7 w-9 shrink-0 place-items-center rounded-lg bg-white/6 text-text-mute"
      aria-hidden
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4.5" width="18" height="11" rx="2.5" />
        <path d="M3 10.5h18M8 4.5v6M12 4.5v6M16 4.5v6" />
        <circle cx="7.5" cy="16.6" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="16.5" cy="16.6" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

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
  stops,
  vehicles,
  stopsVisible,
  onToggleStops,
  onPickStop,
  onPickVehicle,
  baseLayer,
  onBaseLayer,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<number | null>(null);
  const listId = useId();

  useEffect(
    () => () => {
      if (blurTimer.current != null) clearTimeout(blurTimer.current);
    },
    [],
  );

  /* close the menu on outside tap */
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  /* normalize stop names once per stops change, not on every 5 s vehicle poll */
  const stopIndex = useMemo(() => stops.map((s) => ({ s, n: normalizeText(s.name) })), [stops]);

  /* merged, ranked search over live lines + stops. Lower rank = better match.
     Line matches (by number, then direction) rank against stop-name matches so
     "9" surfaces line 9 while "Żywiec" surfaces the town's stops. */
  const results = useMemo<Result[]>(() => {
    const q = normalizeText(query.trim());
    if (!q) return [];
    const scored: { r: Result; rank: number; label: string }[] = [];

    /* live lines — dedupe to one row per line+direction so the two ways of a
       route show once each ("kierunek, żeby się nie pomylić") */
    const seenDir = new Set<string>();
    for (const v of vehicles) {
      const nl = normalizeText(v.line || "");
      const nh = normalizeText(v.headsign || "");
      let rank = -1;
      if (nl && nl === q) rank = 0;
      else if (nl && nl.startsWith(q)) rank = 1;
      else if (nl && nl.includes(q)) rank = 4;
      else if (nh && nh.includes(q)) rank = 5;
      if (rank < 0) continue;
      const key = `${v.line}\u0000${v.headsign}`;
      if (seenDir.has(key)) continue;
      seenDir.add(key);
      scored.push({ r: { kind: "veh", v }, rank, label: `${v.line} ${v.headsign}` });
    }

    /* stops by name (names pre-normalized in stopIndex) */
    for (const { s, n } of stopIndex) {
      let rank = -1;
      if (n.startsWith(q)) rank = 2;
      else if (n.includes(q)) rank = 3;
      if (rank < 0) continue;
      scored.push({ r: { kind: "stop", s }, rank, label: s.name });
    }

    scored.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "pl"));
    return scored.slice(0, MAX_RESULTS).map((x) => x.r);
  }, [query, stopIndex, vehicles]);

  /* `hi` is the raw cursor; the live-vehicle poll can shrink `results` under it,
     so derive a clamped index used for BOTH the shown highlight and Enter —
     they can never disagree, and no row is ever picked that isn't highlighted */
  const active = results.length > 0 ? Math.min(hi, results.length - 1) : 0;

  const pick = (r: Result) => {
    if (r.kind === "stop") onPickStop(r.s);
    else onPickVehicle(r.v);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const activeId = open && results.length > 0 ? optionId(active) : undefined;

  return (
    <div
      ref={rootRef}
      className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[1002] w-[min(400px,calc(100vw-24px))] md:left-1/2 md:-translate-x-1/2"
    >
      {/* search bar */}
      <div className="surface flex h-12 items-center gap-2.5 rounded-full pl-4 pr-1.5">
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
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Szukaj przystanku lub linii"
          placeholder="Szukaj przystanku lub linii…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setMenu(false);
            setHi(0);
          }}
          onFocus={() => {
            if (blurTimer.current != null) {
              clearTimeout(blurTimer.current);
              blurTimer.current = null;
            }
            setOpen(true);
            setMenu(false);
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-text placeholder:text-text-faint focus:outline-none"
        />
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
          aria-label="Ustawienia mapy"
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${
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

      {/* search results — live lines (badge + direction) and stops (stop sign) */}
      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Wyniki wyszukiwania"
          className="surface kb-scroll mt-2 max-h-[min(60vh,420px)] overflow-auto rounded-2xl py-1.5 animate-drop"
        >
          {results.map((r, i) => (
            <li key={resultKey(r)} id={optionId(i)} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                className={`flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13.5px] transition-colors ${
                  i === active ? "bg-primary-dim text-text" : "text-text-mute hover:bg-white/5"
                }`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  pick(r);
                }}
              >
                {r.kind === "veh" ? (
                  <>
                    <LineBadge line={r.v.line || "?"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-text">
                        {r.v.headsign ? `→ ${r.v.headsign}` : `Linia ${r.v.line || "?"}`}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-faint">
                        <span className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-good" aria-hidden />
                        linia na żywo
                        {r.v.delay != null ? ` · ${delayTxt(r.v.delay)}` : ""}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <StopMark />
                    <span className="min-w-0 flex-1 truncate text-text">{r.s.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-text-faint">{r.s.designator}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

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
