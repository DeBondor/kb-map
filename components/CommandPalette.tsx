"use client";

/**
 * Raycast-style command palette (Ctrl/Cmd+K).
 *
 * Split in two so the 5 s vehicle poll can't touch it while closed:
 *  - `CommandPalette` (memo, always mounted) owns only the global shortcut and
 *    renders null when closed — all its props are useCallback-stable.
 *  - `PaletteDialog` mounts only while open and subscribes to the data hooks
 *    itself (`useVehicles` shares the SWR cache — no extra traffic; `useLines`
 *    makes the catalog fetch lazy on first open).
 *
 * Search is in-memory only (stops + static line catalog + live vehicles) —
 * the throttled passthrough routes are never called from here.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useIsDesktop, useLines, useVehicles, type GeoPos, type GeoStatus } from "@/components/hooks";
import { EmptyState, LineBadge, StarIcon } from "@/components/ui";
import { useFavorites } from "@/lib/client/favorites";
import { delayTxt, displayStopName, normalizeText, wozPlural } from "@/lib/client/format";
import { formatDistance, haversineMeters, nearestStops } from "@/lib/client/geo";
import type { BaseLayerId } from "@/components/TopBar";
import type { LineInfo, Stop, Vehicle } from "@/lib/client/types";

export interface CommandPaletteProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  stops: Stop[];
  /** gated by the caller (`open ? geo.pos : null`) so GPS fixes never re-render a closed palette */
  geoPos: GeoPos | null;
  geoStatus: GeoStatus;
  /** fly the map to the user (starting the GPS watch if needed) — never a toggle-off */
  onLocate: () => void;
  /** start the GPS watch without recentering (for the nearest-stops view) */
  onEnsureGeo: () => void;
  onPickStop: (s: Stop) => void;
  onPickVehicle: (v: Vehicle) => void;
  stopsVisible: boolean;
  onToggleStops: () => void;
  onClearView: () => void;
  baseLayer: BaseLayerId;
  onBaseLayer: (id: BaseLayerId) => void;
  lineFilter: ReadonlySet<string> | null;
  onToggleLine: (line: string) => void;
  onClearLineFilter: () => void;
}

/* ---------- result model ---------- */

interface ActionDef {
  id: string;
  label: string;
  /** pre-normalized extra search terms */
  keywords: string;
  icon: React.ReactNode;
  run: () => void;
  /** keep the palette open after running (e.g. line-filter toggles) */
  keepOpen?: boolean;
}

type Item =
  | { kind: "action"; a: ActionDef }
  | { kind: "line"; l: LineInfo; live: number; active: boolean }
  | { kind: "veh"; v: Vehicle }
  | { kind: "stop"; s: Stop; fav: boolean; dist: number | null };

interface Section {
  title: string | null;
  items: Item[];
}

const itemKey = (it: Item): string =>
  it.kind === "action" ? `a-${it.a.id}`
  : it.kind === "line" ? `l-${it.l.id}`
  : it.kind === "veh" ? `v-${it.v.id}`
  : `s-${it.s.id}`;

const CAP = { lines: 4, vehs: 5, actions: 4, stops: 7 } as const;

/* ---------- glyphs (sized like LineBadge so rows align) ---------- */

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-7 w-9 shrink-0 place-items-center rounded-lg bg-white/6 text-text-mute" aria-hidden>
      {children}
    </span>
  );
}

function BusGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="11" rx="2.5" />
      <path d="M3 10.5h18M8 4.5v6M12 4.5v6M16 4.5v6" />
      <circle cx="7.5" cy="16.6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="16.6" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LocateGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function EyeGlyph({ off = false }: { off?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function ThemeGlyph({ dark }: { dark: boolean }) {
  return dark ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 14A8.5 8.5 0 1 1 10 3.5a7 7 0 0 0 10.5 10.5z" />
    </svg>
  );
}

function ClearGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}

function FilterOffGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18l-7 8v5.5l-4 2V13L3 5z" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-text-faint" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/* ---------- dialog ---------- */

function PaletteDialog({
  onClose,
  stops,
  geoPos,
  geoStatus,
  onLocate,
  onEnsureGeo,
  onPickStop,
  onPickVehicle,
  stopsVisible,
  onToggleStops,
  onClearView,
  baseLayer,
  onBaseLayer,
  lineFilter,
  onToggleLine,
  onClearLineFilter,
}: CommandPaletteProps) {
  const { data: vehData } = useVehicles();
  const { data: linesData } = useLines();
  const { favs, favSet } = useFavorites();
  const desktop = useIsDesktop();

  const vehicles = useMemo(() => vehData?.vehicles ?? [], [vehData]);
  const lines = useMemo(() => linesData?.lines ?? [], [linesData]);

  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [view, setView] = useState<"root" | "nearby">("root");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  /* focus the input on mount, hand focus back to the trigger on unmount */
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => prev?.focus();
  }, []);

  /* Escape ladder, capture phase so it wins over BottomSheet's window-bubble
     Escape (an open sheet stays put) and the input's own handler */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (query) {
        setQuery("");
        setHi(0);
      } else if (view === "nearby") {
        setView("root");
        setHi(0);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [query, view, onClose]);

  /* normalize stop names once per stops change, not on every 5 s poll */
  const stopIndex = useMemo(() => stops.map((s) => ({ s, n: normalizeText(s.name) })), [stops]);

  const byDesig = useMemo(() => {
    const m = new Map<string, Stop>();
    for (const s of stops) m.set(s.designator, s);
    return m;
  }, [stops]);

  /* live vehicles per line — shown on line rows ("2 wozy na trasie") */
  const liveByLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of vehicles) if (v.line) m.set(v.line, (m.get(v.line) ?? 0) + 1);
    return m;
  }, [vehicles]);

  const actions = useMemo<ActionDef[]>(() => {
    const list: ActionDef[] = [
      {
        id: "locate",
        label: "Moja lokalizacja",
        keywords: "gdzie jestem gps znajdz mnie lokalizacja",
        icon: <LocateGlyph />,
        run: onLocate,
      },
      {
        id: "nearby",
        label: "Najbliższe przystanki",
        keywords: "w poblizu obok blisko najblizsze przystanki",
        icon: <PinGlyph />,
        run: () => {
          if (!geoPos) onEnsureGeo();
          setQuery("");
          setView("nearby");
          setHi(0);
        },
        keepOpen: true,
      },
      {
        id: "stops-toggle",
        label: stopsVisible ? "Ukryj przystanki" : "Pokaż przystanki",
        keywords: "przystanki ukryj pokaz widocznosc mapa",
        icon: <EyeGlyph off={stopsVisible} />,
        run: onToggleStops,
      },
      {
        id: "map-style",
        label: baseLayer === "dark" ? "Jasna mapa" : "Ciemna mapa",
        keywords: "ciemna jasna mapa styl motyw dark light",
        icon: <ThemeGlyph dark={baseLayer === "dark"} />,
        run: () => onBaseLayer(baseLayer === "dark" ? "kb" : "dark"),
      },
      {
        id: "clear",
        label: "Wyczyść widok",
        keywords: "wyczysc zamknij widok reset",
        icon: <ClearGlyph />,
        run: onClearView,
      },
    ];
    if (lineFilter && lineFilter.size > 0) {
      list.push({
        id: "clear-filter",
        label: "Wyczyść filtr linii",
        keywords: "wyczysc filtr linie pokaz wszystkie",
        icon: <FilterOffGlyph />,
        run: onClearLineFilter,
      });
    }
    return list;
  }, [geoPos, onLocate, onEnsureGeo, stopsVisible, onToggleStops, baseLayer, onBaseLayer, onClearView, lineFilter, onClearLineFilter]);

  /* ---------- sections ---------- */

  const sections = useMemo<Section[]>(() => {
    const q = normalizeText(query.trim());
    const stopDist = (s: Stop) =>
      geoPos ? haversineMeters(geoPos.lat, geoPos.lon, s.lat, s.lon) : null;

    if (view === "nearby" && !q) {
      if (!geoPos) return [];
      return [
        {
          title: "Najbliższe przystanki",
          items: nearestStops(stops, geoPos, 10).map(
            ({ s, dist }): Item => ({ kind: "stop", s, fav: favSet.has(s.designator), dist }),
          ),
        },
      ];
    }

    if (!q) {
      /* root: favorites, nearby (when located), actions */
      const out: Section[] = [];
      const favStops = favs
        .map((d) => byDesig.get(d))
        .filter((s): s is Stop => !!s)
        .map((s): Item => ({ kind: "stop", s, fav: true, dist: stopDist(s) }));
      if (favStops.length) out.push({ title: "Ulubione", items: favStops.slice(0, 6) });
      if (geoPos) {
        out.push({
          title: "W pobliżu",
          items: nearestStops(stops, geoPos, 5).map(
            ({ s, dist }): Item => ({ kind: "stop", s, fav: favSet.has(s.designator), dist }),
          ),
        });
      }
      out.push({ title: "Akcje", items: actions.map((a): Item => ({ kind: "action", a })) });
      return out;
    }

    /* query mode: rank within each group, order groups by their best hit */
    type Scored = { item: Item; rank: number; label: string; dist: number };

    const lineHits: Scored[] = [];
    for (const l of lines) {
      const nl = normalizeText(l.name);
      const nt = normalizeText(l.terminus);
      let rank = -1;
      if (nl === q) rank = 0;
      else if (nl.startsWith(q)) rank = 1;
      else if (nl.includes(q)) rank = 4;
      else if (nt && nt.includes(q)) rank = 4.2;
      if (rank < 0) continue;
      lineHits.push({
        item: { kind: "line", l, live: liveByLine.get(l.name) ?? 0, active: !!lineFilter?.has(l.name) },
        rank,
        label: l.name,
        dist: Infinity,
      });
    }

    const vehHits: Scored[] = [];
    const seenDir = new Set<string>();
    for (const v of vehicles) {
      const nl = normalizeText(v.line || "");
      const nh = normalizeText(v.headsign || "");
      let rank = -1;
      if (nl && nl === q) rank = 0.5;
      else if (nl && nl.startsWith(q)) rank = 1.5;
      else if (nl && nl.includes(q)) rank = 4.5;
      else if (nh && nh.includes(q)) rank = 5;
      if (rank < 0) continue;
      const key = `${v.line} ${v.headsign}`;
      if (seenDir.has(key)) continue;
      seenDir.add(key);
      vehHits.push({ item: { kind: "veh", v }, rank, label: `${v.line} ${v.headsign}`, dist: Infinity });
    }

    const actionHits: Scored[] = [];
    for (const a of actions) {
      const nl = normalizeText(a.label);
      let rank = -1;
      if (nl.startsWith(q)) rank = 2.2;
      else if (nl.includes(q) || a.keywords.includes(q)) rank = 2.5;
      if (rank < 0) continue;
      actionHits.push({ item: { kind: "action", a }, rank, label: a.label, dist: Infinity });
    }

    const stopHits: Scored[] = [];
    for (const { s, n } of stopIndex) {
      let rank = -1;
      if (n.startsWith(q)) rank = 2;
      else if (n.includes(q)) rank = 3;
      if (rank < 0) continue;
      const fav = favSet.has(s.designator);
      if (fav) rank -= 0.5; // favorites float above same-tier hits
      const d = stopDist(s);
      stopHits.push({
        item: { kind: "stop", s, fav, dist: d },
        rank,
        label: s.name,
        dist: d ?? Infinity,
      });
    }

    const finish = (hits: Scored[], cap: number): { items: Item[]; best: number } => {
      hits.sort(
        (a, b) => a.rank - b.rank || a.dist - b.dist || a.label.localeCompare(b.label, "pl"),
      );
      return { items: hits.slice(0, cap).map((h) => h.item), best: hits[0]?.rank ?? Infinity };
    };

    const groups = [
      { title: "Linie", ...finish(lineHits, CAP.lines) },
      { title: "Kursy na żywo", ...finish(vehHits, CAP.vehs) },
      { title: "Akcje", ...finish(actionHits, CAP.actions) },
      { title: "Przystanki", ...finish(stopHits, CAP.stops) },
    ].filter((g) => g.items.length > 0);
    groups.sort((a, b) => a.best - b.best);
    return groups.map(({ title, items }) => ({ title, items }));
  }, [query, view, stops, stopIndex, byDesig, favs, favSet, geoPos, actions, lines, vehicles, liveByLine, lineFilter]);

  const rows = useMemo(() => sections.flatMap((sec) => sec.items), [sections]);

  /* clamp-derive the active row: the 5 s poll can shrink results under the
     cursor, so highlight and Enter must share one clamped index */
  const active = rows.length > 0 ? Math.min(hi, rows.length - 1) : 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll follows the cursor only
  }, [active]);

  const pick = useCallback(
    (it: Item) => {
      if (it.kind === "stop") {
        onPickStop(it.s);
        onClose();
      } else if (it.kind === "veh") {
        onPickVehicle(it.v);
        onClose();
      } else if (it.kind === "line") {
        onToggleLine(it.l.name); // keep open — filters are multi-select
      } else {
        it.a.run();
        if (!it.a.keepOpen) onClose();
      }
    },
    [onPickStop, onPickVehicle, onToggleLine, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!rows.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((active + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((active - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(rows[active]);
    }
  };

  /* ---------- rows ---------- */

  const renderItem = (it: Item, i: number) => {
    const isActive = i === active;
    const base = `flex w-full items-center gap-3 px-3.5 text-left text-[13.5px] min-h-[44px] transition-colors active:bg-white/8 ${
      isActive ? "bg-primary-dim text-text" : "text-text-mute hover:bg-white/5"
    }`;
    return (
      <li key={itemKey(it)} id={optionId(i)} role="option" aria-selected={isActive}>
        <button
          type="button"
          tabIndex={-1}
          className={base}
          onMouseEnter={() => setHi(i)}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault(); // keep the input focused
            pick(it);
          }}
        >
          {it.kind === "stop" && (
            <>
              {it.fav ? (
                <span className="grid h-7 w-9 shrink-0 place-items-center rounded-lg bg-white/6 text-primary" aria-hidden>
                  <StarIcon filled />
                </span>
              ) : (
                <Glyph><BusGlyph /></Glyph>
              )}
              <span className="min-w-0 flex-1 truncate text-text">{displayStopName(it.s.name)}</span>
              {it.dist != null && (
                <span className="shrink-0 text-[11px] tabular-nums text-text-mute">{formatDistance(it.dist)}</span>
              )}
            </>
          )}
          {it.kind === "veh" && (
            <>
              <LineBadge line={it.v.line || "?"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-text">
                  {it.v.headsign ? `→ ${displayStopName(it.v.headsign)}` : `Linia ${it.v.line || "?"}`}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-faint">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-good" aria-hidden />
                  linia na żywo
                  {it.v.delay != null ? ` · ${delayTxt(it.v.delay)}` : ""}
                </span>
              </span>
            </>
          )}
          {it.kind === "line" && (
            <>
              <LineBadge line={it.l.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-text">
                  {it.l.terminus ? `→ ${displayStopName(it.l.terminus)}` : `Linia ${it.l.name}`}
                </span>
                <span className="mt-0.5 block text-[11px] text-text-faint">
                  {it.active
                    ? "filtr aktywny — Enter wyłącza"
                    : it.live > 0
                      ? `${it.live} ${wozPlural(it.live)} na trasie · Enter filtruje`
                      : "brak wozów na trasie · Enter filtruje"}
                </span>
              </span>
              {it.active && <CheckGlyph />}
            </>
          )}
          {it.kind === "action" && (
            <>
              <Glyph>{it.a.icon}</Glyph>
              <span className="min-w-0 flex-1 truncate text-text">{it.a.label}</span>
            </>
          )}
        </button>
      </li>
    );
  };

  let rowIdx = 0;

  const listBody = (
    <div className="relative min-h-0 flex-1">
      {/* scroll-edge under the input row instead of a harder second divider */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-3 bg-gradient-to-b ${
          desktop ? "from-surface" : "from-bg"
        } to-transparent`}
        aria-hidden
      />
      <div className="kb-scroll h-full overflow-y-auto pb-2">
      {view === "nearby" && !geoPos ? (
        <p className="px-5 py-8 text-center text-[13px] text-text-mute" role="status">
          {geoStatus === "denied"
            ? "Brak zgody na lokalizację — włącz ją w ustawieniach przeglądarki."
            : "Ustalanie lokalizacji…"}
        </p>
      ) : rows.length === 0 && query ? (
        <EmptyState text={`Brak wyników dla „${query.trim()}"`} />
      ) : (
        <ul id={listId} role="listbox" aria-label="Wyniki wyszukiwania">
          {sections.map((sec) => [
            sec.title ? (
              <li
                key={`h-${sec.title}`}
                role="presentation"
                className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-text-faint"
              >
                {sec.title}
              </li>
            ) : null,
            ...sec.items.map((it) => renderItem(it, rowIdx++)),
          ])}
        </ul>
      )}
      </div>
    </div>
  );

  const inputRow = (
    <div className="flex h-13 shrink-0 items-center gap-2.5 border-b border-hairline px-4">
      <SearchGlyph />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls={listId}
        aria-activedescendant={rows.length > 0 ? optionId(active) : undefined}
        aria-autocomplete="list"
        aria-label="Szukaj przystanku, linii lub akcji"
        placeholder={view === "nearby" ? "Najbliższe przystanki" : "Szukaj przystanku, linii, akcji…"}
        autoComplete="off"
        autoFocus
        spellCheck={false}
        enterKeyHint="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (view !== "root") setView("root");
          setHi(0);
        }}
        onKeyDown={onKeyDown}
        className="no-focus-ring h-full min-w-0 flex-1 bg-transparent text-[15px] text-text placeholder:text-text-faint focus:outline-none"
      />
      {!desktop && (
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full px-2 py-1 text-[13px] font-semibold text-primary active:scale-95"
        >
          Anuluj
        </button>
      )}
    </div>
  );

  if (!desktop) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Wyszukiwarka"
        className="fixed inset-0 z-[1200] flex h-dvh flex-col bg-bg pt-[env(safe-area-inset-top,0px)] animate-palette-up"
      >
        {inputRow}
        {listBody}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1200]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade"
        onMouseDown={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Wyszukiwarka"
        className="surface absolute left-1/2 top-[16vh] flex max-h-[min(65vh,520px)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl animate-palette"
      >
        {inputRow}
        {listBody}
        <div className="flex shrink-0 items-center gap-3 border-t border-hairline px-4 py-2 text-[11px] text-text-faint">
          <span><kbd className="rounded bg-white/8 px-1">↑↓</kbd> wybierz</span>
          <span><kbd className="rounded bg-white/8 px-1">Enter</kbd> otwórz</span>
          <span><kbd className="rounded bg-white/8 px-1">Esc</kbd> zamknij</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- always-mounted shell: global shortcut only ---------- */

function CommandPalette(props: CommandPaletteProps) {
  const { open, onOpen, onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); // beat the browser's address-bar search
        if (open) onClose();
        else onOpen();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onOpen, onClose]);

  if (!open) return null;
  return <PaletteDialog {...props} />;
}

export default memo(CommandPalette);
