"use client";

import { memo, useEffect, useRef, useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import { useNow } from "@/components/hooks";
import { CloseIcon, EmptyState, ErrorState, IconButton, LineBadge, SkeletonRows } from "@/components/ui";
import { fetchJSON, getTrip } from "@/lib/client/api";
import { countdown, delayClass, delayTxt, hhmmFromSecs, secsFromHHMM, todayISO } from "@/lib/client/format";
import type {
  DepartureRow,
  DeparturesResponse,
  Stop,
  TimetableDeparture,
  TimetableResponse,
} from "@/lib/client/types";

type Tab = "live" | "tt";

interface Props {
  stop: Stop;
  desktop: boolean;
  onClose: () => void;
  onShowLive: (execId: string, tripId: string | number | null) => void;
  onShowStatic: (tripId: string | number) => void;
}

interface TtRow {
  dp: TimetableDeparture;
  line: string;
  dir: string;
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-faint" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function StopView({ stop, desktop, onClose, onShowLive, onShowStatic }: Props) {
  const [tab, setTab] = useState<Tab>("live");
  const [liveRows, setLiveRows] = useState<DepartureRow[] | null>(null);
  /* mirrors liveRows so the refresh closure can tell "have data" without going
     stale — a failed 30 s background refresh must not nuke a list we show */
  const liveRowsRef = useRef<DepartureRow[] | null>(null);
  const [liveErr, setLiveErr] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
  const [tt, setTt] = useState<TtRow[] | null>(null);
  const [ttErr, setTtErr] = useState(false);
  const [ttPhase, setTtPhase] = useState<"timetable" | "trips" | null>(null);
  const now = useNow();

  /* live departures — fetch on open / manual retry + 30 s auto refresh
     (the component is keyed by stop.designator in MapApp, so state resets per stop) */
  useEffect(() => {
    if (tab !== "live") return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchJSON<DeparturesResponse>(
          `/api/stop/${encodeURIComponent(stop.designator)}/departures`,
          { cache: "no-store", signal: ac.signal },
        );
        if (!cancelled) {
          liveRowsRef.current = d.rows ?? [];
          setLiveRows(liveRowsRef.current);
          setLiveErr(false);
        }
      } catch {
        // only surface the error sheet when there is nothing to show; with a
        // list on screen stay silent and let the next 30 s tick retry
        if (!cancelled && !ac.signal.aborted && liveRowsRef.current === null) setLiveErr(true);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [stop.designator, tab, liveTick]);

  useEffect(() => {
    if (tab !== "live") return;
    const id = setInterval(() => setLiveTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [tab, stop.designator]);

  /* today's timetable + per-trip line/direction (client-cached, deduped) */
  useEffect(() => {
    if (tab !== "tt" || tt !== null || ttErr) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        setTtPhase("timetable");
        const d = await fetchJSON<TimetableResponse>(
          `/api/stop/${encodeURIComponent(stop.designator)}/timetable?date=${todayISO()}`,
          { cache: "no-store", signal: ac.signal },
        );
        const deps = d.departures ?? [];
        if (cancelled) return;
        setTtPhase("trips");
        const rows = await Promise.all(
          deps.map(async (dp): Promise<TtRow> => {
            const trip = await getTrip(dp.trip_id, ac.signal);
            return {
              dp,
              line: trip?.line?.name || "?",
              dir: trip?.direction || d.main_direction?.name || "",
            };
          }),
        );
        if (!cancelled) setTt(rows);
      } catch {
        if (!cancelled && !ac.signal.aborted) setTtErr(true);
      } finally {
        if (!cancelled) setTtPhase(null);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tab, tt, ttErr, stop.designator]);

  const liveLoading = liveRows === null && !liveErr;

  const header = (
    <header className="px-4 pb-3 pt-2 md:pt-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-bold leading-tight text-text">{stop.name}</h2>
          <p className="mt-1 text-[11px] text-text-faint">
            przystanek · <span className="tabular-nums">{stop.designator}</span>
          </p>
        </div>
        <IconButton label="Zamknij panel przystanku" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      {/* segmented tabs with sliding thumb */}
      <div
        className="relative mt-3 grid grid-cols-2 rounded-full bg-white/6 p-1"
        role="tablist"
        aria-label="Widok przystanku"
      >
        <span
          className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-surface-3 transition-transform duration-300 ${
            tab === "tt" ? "translate-x-[calc(100%+8px)]" : "translate-x-0"
          }`}
          style={{ transitionTimingFunction: "var(--ease-spring)" }}
          aria-hidden
        />
        {(
          [
            ["live", "Odjazdy"],
            ["tt", "Rozkład dziś"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`relative z-10 rounded-full py-1.5 text-[13px] font-semibold transition-colors ${
              tab === key ? "text-text" : "text-text-mute hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </header>
  );

  return (
    <BottomSheet desktop={desktop} onClose={onClose} ariaLabel={`Przystanek ${stop.name}`} header={header}>
      <div key={tab} className="kb-scroll h-full overflow-y-auto pb-4 animate-fade">
        {tab === "live" ? (
          liveErr ? (
            <ErrorState
              onRetry={() => {
                setLiveErr(false);
                liveRowsRef.current = null;
                setLiveRows(null);
                setLiveTick((t) => t + 1);
              }}
            />
          ) : liveLoading ? (
            <SkeletonRows />
          ) : liveRows && liveRows.length === 0 ? (
            <EmptyState text="Brak przyjazdów w najbliższych godzinach." />
          ) : (
            <ul className="stagger px-2">
              {(liveRows ?? []).map((row, i) => {
                const planned = row.static_time || row.time || "";
                const td = row.time_diff;
                const est = !!row.is_estimated && td != null;
                const actual = est && row.time?.includes(":") ? row.time : planned;
                const line = row.line_name || row.symbol || "?";
                const plannedIsTime = planned.includes(":");
                const sub = [
                  plannedIsTime ? `plan ${planned}` : "",
                  row.platform ? `peron ${row.platform}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => onShowLive(row.trip_execution_id || "", row.trip_id ?? null)}
                      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-all hover:bg-white/5 active:scale-[0.985] active:bg-white/8"
                    >
                      <LineBadge line={line} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-text">
                          {row.direction || `Linia ${line}`}
                        </p>
                        {sub && (
                          <p className="mt-0.5 text-[11px] tabular-nums text-text-faint">{sub}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-[15px] font-bold tabular-nums ${est ? delayClass(td) : "text-text"}`}>
                          {countdown(secsFromHHMM(actual), now) || planned}
                        </p>
                        {est && (
                          <p className={`text-[11px] font-medium tabular-nums ${delayClass(td)}`}>
                            {delayTxt(td)}
                          </p>
                        )}
                      </div>
                      <Chevron />
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : ttErr ? (
          <ErrorState
            onRetry={() => {
              setTtErr(false);
              setTt(null);
            }}
          />
        ) : tt === null ? (
          <>
            <p className="px-4 pt-3 text-center text-[11px] text-text-faint" role="status">
              {ttPhase === "trips" ? "Wczytywanie tras linii…" : "Pobieranie rozkładu…"}
            </p>
            <SkeletonRows />
          </>
        ) : tt.length === 0 ? (
          <EmptyState text="Brak odjazdów dziś." />
        ) : (
          <ul className="stagger px-2">
            {tt.map(({ dp, line, dir }, i) => (
              <li key={`${dp.trip_id}-${i}`}>
                <button
                  type="button"
                  onClick={() => onShowStatic(dp.trip_id)}
                  className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-all hover:bg-white/5 active:scale-[0.985] active:bg-white/8"
                >
                  <LineBadge line={line} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-text">{dir || `Linia ${line}`}</p>
                    {dp.platform && (
                      <p className="mt-0.5 text-[11px] text-text-faint">peron {dp.platform}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-[15px] font-bold tabular-nums text-text">
                    {hhmmFromSecs(dp.departure)}
                  </p>
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}

export default memo(StopView);
