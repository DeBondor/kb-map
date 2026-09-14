"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon, ErrorState, IconButton, LineBadge, StarIcon } from "@/components/ui";
import { getConnections } from "@/lib/client/api";
import { useFavorites } from "@/lib/client/favorites";
import {
  addMinutesToHHMM,
  displayStopName,
  formatDayLabel,
  normalizeText,
  nowHHMM,
  offsetDateISO,
  przystanekPlural,
  todayISO,
} from "@/lib/client/format";
import { formatDistance, haversineMeters, nearestStops } from "@/lib/client/geo";
import type { ConnectionItinerary, Stop } from "@/lib/client/types";
import type { GeoPos } from "@/components/hooks";

export interface ConnectionsModalProps {
  open: boolean;
  onClose: () => void;
  stops: Stop[];
  geoPos: GeoPos | null;
  initialFrom?: Stop | null;
  initialTo?: Stop | null;
  onSelectStop: (s: Stop) => void;
  onSelectConnection?: (conn: ConnectionItinerary, selectedLegIdx?: number | null) => void;
}

function SwapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function BusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="16" rx="2" />
      <path d="M3 11h18" />
      <circle cx="7" cy="15" r="1" />
      <circle cx="17" cy="15" r="1" />
      <path d="M5 19v2m14-2v2" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * 24-Hour Time Input Component
 * Strictly enforces 24-hour format (00:00 - 23:59) across all devices and browsers,
 * preventing any browser-level AM/PM interference.
 */
function TimeInput24H({
  hour,
  minute,
  onChange,
  onBlur,
}: {
  hour: string;
  minute: string;
  onChange: (h: string, m: string) => void;
  onBlur?: () => void;
}) {
  const hourRef = useRef<HTMLInputElement>(null);
  const minRef = useRef<HTMLInputElement>(null);

  const handleHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
    onChange(raw, minute);
    if (raw.length === 2 || (raw.length === 1 && Number(raw) >= 3)) {
      minRef.current?.focus();
      minRef.current?.select();
    }
  };

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
    onChange(hour, raw);
  };

  const handleHourKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = (parseInt(hour || "0", 10) + 1) % 24;
      onChange(String(n).padStart(2, "0"), minute);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = (parseInt(hour || "0", 10) + 23) % 24;
      onChange(String(n).padStart(2, "0"), minute);
    } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) {
      minRef.current?.focus();
    }
  };

  const handleMinKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = (parseInt(minute || "0", 10) + 5) % 60;
      onChange(hour, String(n).padStart(2, "0"));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = (parseInt(minute || "0", 10) + 55) % 60;
      onChange(hour, String(n).padStart(2, "0"));
    } else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) {
      hourRef.current?.focus();
    } else if (e.key === "Backspace" && !minute) {
      hourRef.current?.focus();
    }
  };

  return (
    <div className="flex items-center rounded-xl bg-white/8 border border-white/10 px-2 py-0.5 text-text focus-within:border-brand/70 focus-within:ring-1 focus-within:ring-brand/40 transition-colors">
      <input
        ref={hourRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={hour}
        onChange={handleHourChange}
        onKeyDown={handleHourKeyDown}
        onBlur={onBlur}
        className="w-5 text-center text-xs font-bold tabular-nums bg-transparent outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 placeholder:text-text-faint"
        placeholder="00"
        aria-label="Godzina w formacie 24-godzinnym (00-23)"
      />
      <span className="text-text-faint font-bold select-none px-0.5">:</span>
      <input
        ref={minRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={minute}
        onChange={handleMinChange}
        onKeyDown={handleMinKeyDown}
        onBlur={onBlur}
        className="w-5 text-center text-xs font-bold tabular-nums bg-transparent outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 placeholder:text-text-faint"
        placeholder="00"
        aria-label="Minuty w formacie 24-godzinnym (00-59)"
      />
      <span className="ml-1 select-none text-[9px] font-bold text-text-faint tracking-wider">24H</span>
    </div>
  );
}

function ConnectionsDialog({
  onClose,
  stops,
  geoPos,
  initialFrom,
  initialTo,
  onSelectStop,
  onSelectConnection,
}: Omit<ConnectionsModalProps, "open">) {
  const [fromStop, setFromStop] = useState<Stop | null>(initialFrom ?? null);
  const [toStop, setToStop] = useState<Stop | null>(initialTo ?? null);
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [activeInput, setActiveInput] = useState<"from" | "to" | null>(
    !initialFrom ? "from" : !initialTo ? "to" : null,
  );

  // Day selection state
  const todayStr = useMemo(() => todayISO(), []);
  const tomorrowStr = useMemo(() => offsetDateISO(todayStr, 1), [todayStr]);
  const [dateMode, setDateMode] = useState<"today" | "tomorrow" | "custom">("today");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // 24-hour time selection state
  const [timeMode, setTimeMode] = useState<"now" | "custom">("now");
  const [hour, setHour] = useState(() => nowHHMM().split(":")[0]);
  const [minute, setMinute] = useState(() => nowHHMM().split(":")[1]);

  // Filters state
  const [directOnly, setDirectOnly] = useState(false);
  const [minTransfer5, setMinTransfer5] = useState(false);
  const [sortBy, setSortBy] = useState<"departure" | "duration">("departure");

  const [connections, setConnections] = useState<ConnectionItinerary[] | null>(null);
  const [connErr, setConnErr] = useState(false);
  const [searchTick, setSearchTick] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

  const { favs, favSet } = useFavorites();

  // Pre-normalized stop lookup index
  const stopIndex = useMemo(() => stops.map((s) => ({ s, n: normalizeText(s.name) })), [stops]);
  const byDesig = useMemo(() => {
    const m = new Map<string, Stop>();
    for (const s of stops) m.set(s.designator, s);
    return m;
  }, [stops]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Derived effective time parameter (HH:MM in 24h format)
  const effectiveTimeParam = useMemo(() => {
    if (timeMode === "now" && dateMode === "today") {
      return undefined; // live search from current second
    }
    const h = hour.padStart(2, "0");
    const m = minute.padStart(2, "0");
    return `${h}:${m}`;
  }, [timeMode, dateMode, hour, minute]);

  const effectiveDayLabel = useMemo(() => {
    if (dateMode === "today") return "Dziś";
    if (dateMode === "tomorrow") return "Jutro";
    return formatDayLabel(selectedDate, todayStr);
  }, [dateMode, selectedDate, todayStr]);

  // Async connection fetcher
  useEffect(() => {
    if (!fromStop || !toStop) return;
    const ac = new AbortController();
    let cancelled = false;
    const fromParam = fromStop.id || fromStop.name;
    const toParam = toStop.id || toStop.name;

    (async () => {
      try {
        const list = await getConnections(fromParam, toParam, {
          time: effectiveTimeParam,
          date: selectedDate,
          dayLabel: effectiveDayLabel,
          directOnly,
          minTransfer: minTransfer5 ? 5 : undefined,
          sortBy,
          signal: ac.signal,
        });
        if (!cancelled) {
          setConnections(list);
          setConnErr(false);
        }
      } catch {
        if (!cancelled && !ac.signal.aborted) {
          setConnErr(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    fromStop,
    toStop,
    effectiveTimeParam,
    selectedDate,
    effectiveDayLabel,
    directOnly,
    minTransfer5,
    sortBy,
    searchTick,
  ]);

  const handleRefresh = useCallback(() => {
    setConnections(null);
    setConnErr(false);
    setSearchTick((t) => t + 1);
  }, []);

  const handleSwap = useCallback(() => {
    setFromStop(toStop);
    setToStop(fromStop);
    setFromQuery("");
    setToQuery("");
    setActiveInput(null);
    setConnections(null);
    setConnErr(false);
    setExpandedIdx(null);
  }, [fromStop, toStop]);

  const handlePickStop = useCallback(
    (s: Stop, target: "from" | "to") => {
      if (target === "from") {
        setFromStop(s);
        setFromQuery("");
        setConnections(null);
        setConnErr(false);
        if (!toStop) {
          setActiveInput("to");
          setTimeout(() => toInputRef.current?.focus(), 50);
        } else {
          setActiveInput(null);
        }
      } else {
        setToStop(s);
        setToQuery("");
        setConnections(null);
        setConnErr(false);
        setActiveInput(null);
      }
    },
    [toStop],
  );

  const handlePickToday = useCallback(() => {
    setDateMode("today");
    setSelectedDate(todayStr);
    setConnections(null);
  }, [todayStr]);

  const handlePickTomorrow = useCallback(() => {
    setDateMode("tomorrow");
    setSelectedDate(tomorrowStr);
    setTimeMode("custom");
    setHour("05");
    setMinute("00");
    setConnections(null);
  }, [tomorrowStr]);

  const handleEarlierConnections = useCallback(() => {
    if (!connections || connections.length === 0) return;
    const firstDep = connections[0].departureTime;
    const earlier = addMinutesToHHMM(firstDep, -60);
    const [h, m] = earlier.split(":");
    setHour(h);
    setMinute(m);
    setTimeMode("custom");
    setConnections(null);
  }, [connections]);

  const handleLaterConnections = useCallback(() => {
    if (!connections || connections.length === 0) return;
    const lastDep = connections[connections.length - 1].departureTime;
    const later = addMinutesToHHMM(lastDep, 15);
    const [h, m] = later.split(":");
    setHour(h);
    setMinute(m);
    setTimeMode("custom");
    setConnections(null);
  }, [connections]);

  const handleOpenDatePicker = useCallback(() => {
    try {
      dateInputRef.current?.showPicker?.();
    } catch {
      dateInputRef.current?.focus();
    }
  }, []);

  const handleSetNow = useCallback(() => {
    setTimeMode("now");
    const [h, m] = nowHHMM().split(":");
    setHour(h);
    setMinute(m);
    setDateMode("today");
    setSelectedDate(todayStr);
    setConnections(null);
  }, [todayStr]);

  const handleAddMinutes = useCallback(
    (delta: number) => {
      const baseTime =
        timeMode === "now" ? nowHHMM() : `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
      const next = addMinutesToHHMM(baseTime, delta);
      const [h, m] = next.split(":");
      setHour(h);
      setMinute(m);
      setTimeMode("custom");
      setConnections(null);
    },
    [timeMode, hour, minute],
  );

  const handleTimeBlur = useCallback(() => {
    let h = parseInt(hour, 10);
    let m = parseInt(minute, 10);
    if (isNaN(h) || h < 0) h = 0;
    if (h > 23) h = 23;
    if (isNaN(m) || m < 0) m = 0;
    if (m > 59) m = 59;
    setHour(String(h).padStart(2, "0"));
    setMinute(String(m).padStart(2, "0"));
    setTimeMode("custom");
  }, [hour, minute]);

  const loading = connections === null && !connErr && !!fromStop && !!toStop;

  // Suggestions for currently active input (deduplicated by stop display name)
  const suggestions = useMemo(() => {
    if (!activeInput) return [];
    const q = normalizeText((activeInput === "from" ? fromQuery : toQuery).trim());
    const stopDist = (s: Stop) =>
      geoPos ? haversineMeters(geoPos.lat, geoPos.lon, s.lat, s.lon) : null;

    if (!q) {
      const list: Array<{ s: Stop; label: string; fav: boolean; dist: number | null }> = [];
      const seenNames = new Set<string>();
      // Favorite stops
      for (const desig of favs) {
        const s = byDesig.get(desig);
        if (s) {
          const key = normalizeText(s.name);
          if (!seenNames.has(key)) {
            seenNames.add(key);
            list.push({ s, label: s.name, fav: true, dist: stopDist(s) });
          }
        }
      }
      // Nearest stops if geolocation is available
      if (geoPos) {
        const nearest = nearestStops(stops, geoPos, 12);
        for (const { s, dist } of nearest) {
          const key = normalizeText(s.name);
          if (!seenNames.has(key)) {
            seenNames.add(key);
            list.push({ s, label: s.name, fav: favSet.has(s.designator), dist });
          }
        }
      }
      return list.slice(0, 8);
    }

    // Match query
    const hits: Array<{ s: Stop; rank: number; dist: number | null }> = [];
    for (const { s, n } of stopIndex) {
      let rank = -1;
      if (n === q) rank = 0;
      else if (n.startsWith(q)) rank = 1;
      else if (n.includes(q)) rank = 3;
      if (rank < 0) continue;
      const fav = favSet.has(s.designator);
      if (fav) rank -= 0.5;
      hits.push({ s, rank, dist: stopDist(s) });
    }
    hits.sort((a, b) => a.rank - b.rank || (a.dist ?? Infinity) - (b.dist ?? Infinity));

    const deduped: Array<{ s: Stop; label: string; fav: boolean; dist: number | null }> = [];
    const seenNames = new Set<string>();
    for (const h of hits) {
      const key = normalizeText(h.s.name);
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      deduped.push({
        s: h.s,
        label: h.s.name,
        fav: favSet.has(h.s.designator),
        dist: h.dist,
      });
      if (deduped.length >= 10) break;
    }
    return deduped;
  }, [activeInput, fromQuery, toQuery, geoPos, favs, favSet, byDesig, stops, stopIndex]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Wyszukiwarka połączeń"
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade md:items-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="surface relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 shadow-2xl md:max-h-[88vh] md:max-w-xl md:rounded-3xl animate-drop">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-hairline px-4 pb-3 pt-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-brand" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="19" r="3" />
                <path d="M9 19h8.5a4.5 4.5 0 0 0 0-9H7a4 4 0 0 1 0-8h11" />
                <polyline points="15 5 18 2 21 5" />
              </svg>
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-text">Wyszukaj połączenie</h2>
              <p className="text-[11px] text-text-faint">Rozkład jazdy Komunikacji Beskidzkiej</p>
            </div>
          </div>
          <IconButton label="Zamknij" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </header>

        {/* Inputs & Controls panel */}
        <div className="border-b border-hairline bg-surface-2 px-4 py-3 space-y-2.5">
          {/* FROM / TO inputs */}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              {/* FROM input */}
              <div className="relative flex h-10 items-center rounded-xl bg-white/6 px-3 transition-colors focus-within:bg-white/10 focus-within:ring-1 focus-within:ring-primary/50">
                <span className="mr-2.5 h-2 w-2 rounded-full bg-good shrink-0" aria-hidden />
                <input
                  ref={fromInputRef}
                  type="text"
                  placeholder="Skąd: przystanek początkowy…"
                  value={fromStop && activeInput !== "from" ? displayStopName(fromStop.name) : fromQuery}
                  onFocus={() => {
                    setActiveInput("from");
                    if (fromStop) setFromQuery(fromStop.name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && suggestions.length > 0) {
                      e.preventDefault();
                      handlePickStop(suggestions[0].s, "from");
                    }
                  }}
                  onChange={(e) => {
                    setFromQuery(e.target.value);
                    if (fromStop) {
                      setFromStop(null);
                      setConnections(null);
                    }
                  }}
                  className="w-full min-w-0 bg-transparent text-[13px] font-medium text-text placeholder:text-text-faint outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0"
                />
                {(fromStop || fromQuery) && (
                  <button
                    type="button"
                    aria-label="Wyczyść przystanek początkowy"
                    onClick={() => {
                      setFromStop(null);
                      setFromQuery("");
                      setConnections(null);
                      setActiveInput("from");
                      fromInputRef.current?.focus();
                    }}
                    className="grid h-6 w-6 place-items-center rounded-full text-text-faint hover:text-text"
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>

              {/* TO input */}
              <div className="relative flex h-10 items-center rounded-xl bg-white/6 px-3 transition-colors focus-within:bg-white/10 focus-within:ring-1 focus-within:ring-primary/50">
                <span className="mr-2.5 h-2 w-2 rounded-full bg-danger shrink-0" aria-hidden />
                <input
                  ref={toInputRef}
                  type="text"
                  placeholder="Dokąd: przystanek docelowy…"
                  value={toStop && activeInput !== "to" ? displayStopName(toStop.name) : toQuery}
                  onFocus={() => {
                    setActiveInput("to");
                    if (toStop) setToQuery(toStop.name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && suggestions.length > 0) {
                      e.preventDefault();
                      handlePickStop(suggestions[0].s, "to");
                    }
                  }}
                  onChange={(e) => {
                    setToQuery(e.target.value);
                    if (toStop) {
                      setToStop(null);
                      setConnections(null);
                    }
                  }}
                  className="w-full min-w-0 bg-transparent text-[13px] font-medium text-text placeholder:text-text-faint outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0"
                />
                {(toStop || toQuery) && (
                  <button
                    type="button"
                    aria-label="Wyczyść przystanek docelowy"
                    onClick={() => {
                      setToStop(null);
                      setToQuery("");
                      setConnections(null);
                      setActiveInput("to");
                      toInputRef.current?.focus();
                    }}
                    className="grid h-6 w-6 place-items-center rounded-full text-text-faint hover:text-text"
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>
            </div>

            {/* Swap button */}
            <button
              type="button"
              aria-label="Zamień kierunki"
              title="Zamień kierunki"
              onClick={handleSwap}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/6 text-text-mute transition-all hover:bg-white/10 hover:text-text active:scale-90"
            >
              <SwapIcon />
            </button>
          </div>

          {/* Day selection row */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] font-semibold text-text-faint mr-0.5">Dzień:</span>
            <button
              type="button"
              onClick={handlePickToday}
              className={`rounded-full px-2.5 py-1 font-semibold transition-all ${
                dateMode === "today"
                  ? "bg-brand text-on-brand shadow-sm"
                  : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text"
              }`}
            >
              Dziś
            </button>
            <button
              type="button"
              onClick={handlePickTomorrow}
              className={`rounded-full px-2.5 py-1 font-semibold transition-all ${
                dateMode === "tomorrow"
                  ? "bg-brand text-on-brand shadow-sm"
                  : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text"
              }`}
            >
              Jutro
            </button>

            {/* Custom date button & hidden native picker */}
            <label
              onClick={handleOpenDatePicker}
              className={`relative flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-all cursor-pointer select-none ${
                dateMode === "custom"
                  ? "bg-brand text-on-brand shadow-sm"
                  : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text"
              }`}
            >
              <CalendarIcon />
              <span>{dateMode === "custom" ? formatDayLabel(selectedDate, todayStr) : "Inna data"}</span>
              <input
                ref={dateInputRef}
                type="date"
                min={todayStr}
                value={selectedDate}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setSelectedDate(val);
                  if (val === todayStr) {
                    setDateMode("today");
                  } else if (val === tomorrowStr) {
                    setDateMode("tomorrow");
                  } else {
                    setDateMode("custom");
                  }
                  if (val !== todayStr && timeMode === "now") {
                    setTimeMode("custom");
                    setHour("05");
                    setMinute("00");
                  }
                  setConnections(null);
                }}
                className="absolute inset-0 opacity-0 pointer-events-none"
                tabIndex={-1}
                aria-label="Wybierz inną datę połączenia"
              />
            </label>
          </div>

          {/* 24-Hour Time selection row */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-text-faint mr-0.5">Odjazd:</span>

              {dateMode === "today" && (
                <button
                  type="button"
                  onClick={handleSetNow}
                  className={`rounded-full px-2.5 py-1 font-semibold transition-all ${
                    timeMode === "now"
                      ? "bg-brand text-on-brand shadow-sm"
                      : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text"
                  }`}
                >
                  Teraz
                </button>
              )}

              {/* Explicit 24h Time Stepper */}
              <TimeInput24H
                hour={hour}
                minute={minute}
                onChange={(h, m) => {
                  setHour(h);
                  setMinute(m);
                  setTimeMode("custom");
                }}
                onBlur={handleTimeBlur}
              />

              {/* Quick time adjustment presets */}
              <button
                type="button"
                onClick={() => handleAddMinutes(15)}
                className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] font-semibold text-text-mute hover:bg-white/10 hover:text-text transition-colors"
                title="Dodaj 15 minut"
              >
                +15m
              </button>
              <button
                type="button"
                onClick={() => handleAddMinutes(30)}
                className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] font-semibold text-text-mute hover:bg-white/10 hover:text-text transition-colors"
                title="Dodaj 30 minut"
              >
                +30m
              </button>
              <button
                type="button"
                onClick={() => handleAddMinutes(60)}
                className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] font-semibold text-text-mute hover:bg-white/10 hover:text-text transition-colors"
                title="Dodaj 1 godzinę"
              >
                +1h
              </button>
            </div>

            {fromStop && toStop && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                className="rounded-full bg-white/10 px-3 py-1 font-semibold text-text transition-all hover:bg-white/15 active:scale-95 disabled:opacity-50"
              >
                {loading ? "Szukanie…" : "Odśwież"}
              </button>
            )}
          </div>

          {/* Filter chips row */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-hairline/60">
            <span className="text-[11px] font-semibold text-text-faint mr-0.5">Filtry:</span>

            {/* Direct only filter chip */}
            <button
              type="button"
              onClick={() => {
                setDirectOnly((prev) => !prev);
                setConnections(null);
              }}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-all ${
                directOnly
                  ? "bg-good/20 text-good border border-good/40 shadow-sm"
                  : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text border border-transparent"
              }`}
              aria-pressed={directOnly}
              title="Pokaż wyłącznie bezpośrednie połączenia bez przesiadek"
            >
              <BusIcon />
              <span>Tylko bezpośrednie</span>
              {directOnly && <span className="text-good font-bold">✓</span>}
            </button>

            {/* Min 5 min transfer buffer (when transfers are allowed) */}
            {!directOnly && (
              <button
                type="button"
                onClick={() => {
                  setMinTransfer5((prev) => !prev);
                  setConnections(null);
                }}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-all ${
                  minTransfer5
                    ? "bg-primary/20 text-primary border border-primary/40 shadow-sm"
                    : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text border border-transparent"
                }`}
                aria-pressed={minTransfer5}
                title="Filtruj połączenia z bezpiecznym czasem na przesiadkę (min. 5 minut)"
              >
                <ShieldIcon />
                <span>Bezpieczna przesiadka (5 min)</span>
                {minTransfer5 && <span className="font-bold">✓</span>}
              </button>
            )}

            {/* Sort order toggle chip */}
            <button
              type="button"
              onClick={() => {
                setSortBy((s) => (s === "departure" ? "duration" : "departure"));
                setConnections(null);
              }}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-all ${
                sortBy === "duration"
                  ? "bg-brand/20 text-brand border border-brand/40 shadow-sm"
                  : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text border border-transparent"
              }`}
              title={
                sortBy === "duration"
                  ? "Sortowanie: najkrótszy całkowity czas podróży"
                  : "Sortowanie: najwcześniejszy odjazd"
              }
            >
              {sortBy === "duration" ? <ZapIcon /> : <ClockIcon />}
              <span>{sortBy === "duration" ? "Najszybsza trasa" : "Wg odjazdu"}</span>
            </button>
          </div>
        </div>

        {/* Modal body */}
        <div className="kb-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {/* Autocomplete suggestion list when user is picking stops */}
          {activeInput ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                {activeInput === "from" ? "Wybierz przystanek początkowy" : "Wybierz przystanek docelowy"}
              </p>
              {suggestions.length === 0 ? (
                <p className="py-6 text-center text-xs text-text-faint">Nie znaleziono pasujących przystanków.</p>
              ) : (
                <ul className="space-y-1">
                  {suggestions.map((item) => (
                    <li key={item.s.id}>
                      <button
                        type="button"
                        onClick={() => handlePickStop(item.s, activeInput)}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/8 active:bg-white/12"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {item.fav ? (
                            <StarIcon filled />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-white/30" aria-hidden />
                          )}
                          <span className="truncate text-[13px] font-medium text-text">
                            {displayStopName(item.s.name)}
                          </span>
                        </div>
                        {item.dist != null && (
                          <span className="ml-2 shrink-0 text-[11px] tabular-nums text-text-faint">
                            {formatDistance(item.dist)}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : loading ? (
            /* Loading skeletons */
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl bg-white/4 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="skeleton h-4 w-28 rounded-lg" />
                    <div className="skeleton h-4 w-16 rounded-lg" />
                  </div>
                  <div className="skeleton h-3 w-40 rounded-lg" />
                </div>
              ))}
            </div>
          ) : connErr ? (
            <ErrorState onRetry={handleRefresh} />
          ) : connections ? (
            connections.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/6 text-text-faint">
                  <BusIcon />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text">
                    {directOnly ? "Brak bezpośrednich połączeń" : "Brak dostępnych połączeń"}
                  </p>
                  <p className="mt-1 text-xs text-text-faint max-w-sm mx-auto">
                    {directOnly
                      ? "W rozkładzie nie ma bezpośredniego autobusu na wybraną godzinę. Spróbuj wyłączyć filtr, aby zobaczyć połączenia z przesiadką."
                      : dateMode === "today"
                        ? `Brak dalszych kursów na dziś od godziny ${hour}:${minute}. Sprawdź połączenia na jutro.`
                        : "Brak kursów w rozkładzie jazdy na wybrany dzień i godzinę."}
                  </p>
                </div>
                <div className="flex justify-center gap-2 pt-2">
                  {directOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        setDirectOnly(false);
                        setConnections(null);
                      }}
                      className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-on-brand transition-all hover:brightness-110 active:scale-95"
                    >
                      Pokaż z przesiadkami
                    </button>
                  )}
                  {dateMode === "today" && (
                    <button
                      type="button"
                      onClick={handlePickTomorrow}
                      className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-text transition-all hover:bg-white/15 active:scale-95"
                    >
                      Szukaj na jutro
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                    Znalezione połączenia ({connections.length})
                  </p>
                  <span className="text-[11px] font-medium text-text-mute">
                    {effectiveDayLabel}
                  </span>
                </div>

                {/* Earlier connections button */}
                <div className="flex justify-center pt-0.5">
                  <button
                    type="button"
                    onClick={handleEarlierConnections}
                    className="flex items-center gap-1.5 rounded-full bg-white/6 px-4 py-1.5 text-xs font-semibold text-text-mute hover:bg-white/10 hover:text-text active:scale-95 transition-all"
                  >
                    <span className="text-[10px]">▲</span>
                    <span>Wcześniejsze połączenia</span>
                  </button>
                </div>

                {connections.map((conn, idx) => {
                  const isExpanded = expandedIdx === idx;
                  const isDirect = conn.type === "direct";
                  const dayBadge = conn.dayLabel || effectiveDayLabel;

                  return (
                    <div
                      key={`${conn.departureTime}-${conn.arrivalTime}-${idx}`}
                      className="rounded-2xl border border-white/6 bg-white/4 p-3.5 transition-colors hover:bg-white/6"
                    >
                      {/* Summary row */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-text-mute">
                              {dayBadge}
                            </span>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-[18px] font-bold tabular-nums text-text">
                                {conn.departureTime}
                              </span>
                              <span className="text-text-faint text-sm">→</span>
                              <span className="text-[18px] font-bold tabular-nums text-text">
                                {conn.arrivalTime}
                              </span>
                              {conn.arrivesNextDay && (
                                <span
                                  className="rounded bg-warning/20 px-1 py-0.2 text-[10px] font-bold text-warning"
                                  title="Przyjazd następnego dnia"
                                >
                                  +1 d.
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="mt-1 text-xs text-text-mute">
                            Czas podróży: <span className="font-semibold text-text">{conn.totalDurationMins} min</span>
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            isDirect ? "bg-good/15 text-good" : "bg-warning/15 text-warning"
                          }`}
                        >
                          {isDirect ? "Bezpośredni" : "1 przesiadka"}
                        </span>
                      </div>

                      {/* Line badges summary */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {conn.legs.map((leg, lIdx) => (
                          <div key={lIdx} className="flex items-center gap-1.5">
                            {lIdx > 0 && <span className="text-xs text-text-faint">➔</span>}
                            <LineBadge line={leg.line} />
                            <span className="truncate text-xs font-medium text-text-mute max-w-[140px]">
                              {displayStopName(leg.headsign)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Transfer info if applicable */}
                      {!isDirect && conn.transferStopName && (
                        <p className="mt-2 text-[11px] text-text-faint">
                          Przesiadka: <strong className="text-text-mute">{displayStopName(conn.transferStopName)}</strong>{" "}
                          (oczekiwanie: {conn.transferWaitMins ?? 0} min)
                        </p>
                      )}

                      {/* Collapsible leg details */}
                      <div className="mt-3 border-t border-hairline pt-2.5">
                        <button
                          type="button"
                          onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                          className="flex w-full items-center justify-between text-xs font-medium text-text-mute hover:text-text"
                        >
                          <span>{isExpanded ? "Ukryj szczegóły trasy" : "Pokaż szczegóły trasy"}</span>
                          <ChevronDown open={isExpanded} />
                        </button>

                        {isExpanded && (
                          <div className="mt-3 space-y-3 text-xs animate-fade">
                            {conn.legs.map((leg, lIdx) => (
                              <div key={lIdx} className="rounded-xl bg-white/4 p-2.5">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <LineBadge line={leg.line} />
                                    <span className="font-semibold text-text">
                                      Kierunek: {displayStopName(leg.headsign)}
                                    </span>
                                  </div>
                                  <span className="tabular-nums text-text-faint">
                                    {leg.stopsCount} {przystanekPlural(leg.stopsCount)} · {leg.durationMins} min
                                  </span>
                                </div>
                                <div className="mt-2 space-y-1 pl-2 text-[11px] text-text-mute border-l-2 border-primary/40">
                                  <p>
                                    <strong className="tabular-nums text-text">{leg.departureTime}</strong>{" "}
                                    {displayStopName(leg.fromStopName)}
                                  </p>
                                  <p>
                                    <strong className="tabular-nums text-text">{leg.arrivalTime}</strong>{" "}
                                    {displayStopName(leg.toStopName)}
                                  </p>
                                </div>
                                <div className="mt-2 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (onSelectConnection) onSelectConnection(conn, lIdx);
                                      onClose();
                                    }}
                                    className="text-[11px] font-semibold text-brand hover:underline transition-colors flex items-center gap-1"
                                  >
                                    <span>Pokaż ten odcinek na mapie</span>
                                    <span>→</span>
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5">
                        <span className="text-[11px] text-text-faint">
                          {conn.legs.length > 1
                            ? `${conn.legs.length} linie · ${conn.transfersCount} ${conn.transfersCount === 1 ? "przesiadka" : "przesiadki"}`
                            : "Bez przesiadek"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (onSelectConnection) onSelectConnection(conn, null);
                            else if (fromStop) onSelectStop(fromStop);
                            onClose();
                          }}
                          className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-on-brand transition-all hover:brightness-110 active:scale-95 shadow-sm"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
                            <line x1="9" y1="3" x2="9" y2="18" />
                            <line x1="15" y1="6" x2="15" y2="21" />
                          </svg>
                          <span>Pokaż całą trasę na mapie</span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Later connections button */}
                <div className="flex justify-center pt-1 pb-1">
                  <button
                    type="button"
                    onClick={handleLaterConnections}
                    className="flex items-center gap-1.5 rounded-full bg-white/6 px-4 py-1.5 text-xs font-semibold text-text-mute hover:bg-white/10 hover:text-text active:scale-95 transition-all"
                  >
                    <span className="text-[10px]">▼</span>
                    <span>Późniejsze połączenia</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            /* Initial state before picking stops */
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-text">Wybierz przystanek początkowy i docelowy</p>
              <p className="mt-1 text-xs text-text-faint">
                Wyszukiwarka znajdzie najszybsze połączenia autobusowe w sieci Komunikacji Beskidzkiej.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionsModal(props: ConnectionsModalProps) {
  if (!props.open) return null;
  return <ConnectionsDialog {...props} />;
}

export default memo(ConnectionsModal);
