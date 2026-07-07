"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import BottomSheet from "@/components/BottomSheet";
import { useNow } from "@/components/hooks";
import { BackIcon, CloseIcon, ErrorState, IconButton, LineBadge } from "@/components/ui";
import { computeEta, delayClass, delayTxt, detectLoopStops, hhmmFromSecs, hslColor, secsFromHHMM } from "@/lib/client/format";
import type { Stop, TripView as TripViewState, Vehicle } from "@/lib/client/types";

interface Props {
  trip: TripViewState;
  desktop: boolean;
  /** vehicle the trip was opened from (extra header context), if any */
  vehMeta: Vehicle | null;
  /** fresh live poll for this trip's vehicle (matched by exec id) — advances the
   *  highlighted stop, the "pojazd na" line and the header delay in real time */
  liveVeh: Vehicle | null;
  /** present when the trip was opened from a stop panel — returns to it */
  onBack: (() => void) | null;
  onClose: () => void;
  onFocusStop: (s: Stop) => void;
  onRetry: () => void;
}

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-text-faint border-t-text align-[-1px]"
      aria-hidden
    />
  );
}

function TimelineSkeleton() {
  return (
    <div aria-hidden className="px-5 pt-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <div className="skeleton h-3.5 w-10" />
          <div className="skeleton h-3 w-3 rounded-full" />
          <div className="skeleton h-3.5 flex-1" />
        </div>
      ))}
    </div>
  );
}

function TripView({ trip, desktop, vehMeta, liveVeh, onBack, onClose, onFocusStop, onRetry }: Props) {
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);

  const lineColor = hslColor(trip.line === "…" ? null : trip.line);
  const loading = trip.status === "loading";
  const failed = trip.status === "error";
  /* prefer the live poll's current stop over the (frozen) value the route was
     opened with, so the highlight and "pojazd na" advance as the bus moves */
  const liveVti = liveVeh ? liveVeh.current_stop_sequence : null;
  const vti = liveVti ?? trip.vti;
  const eta = loading || failed ? "" : computeEta({ ...trip, vti }, now);

  /** schedule index → resolved physical stop (for fly-to on tap) */
  const stopByIndex = useMemo(() => {
    const m = new Map<number, Stop>();
    for (const r of trip.stops) m.set(r.t.index, r.s);
    return m;
  }, [trip.stops]);

  /* keep the vehicle's current stop in view; re-runs as the live stop advances */
  useEffect(() => {
    if (vti == null || trip.status === "loading") return;
    currentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [vti, trip.status, trip.gen]);

  const direction = trip.direction || vehMeta?.headsign || "";
  const headerDelay =
    liveVeh?.delay ?? vehMeta?.delay ?? trip.rawTimes[vti ?? -1]?.estimate?.time_diff ?? null;
  /* stops this course loops through (e.g. the SZCZYRK BIŁA spur on some 120s) —
     shown as a "przez …" badge so a via-the-loop run is obvious */
  const loopStops = useMemo(() => detectLoopStops(trip.rawTimes), [trip.rawTimes]);

  const header = (
    <header className="px-4 pb-3 pt-2 md:pt-4">
      <div className="flex items-center gap-2.5">
        {onBack && (
          <IconButton label="Wróć do przystanku" onClick={onBack}>
            <BackIcon />
          </IconButton>
        )}
        <LineBadge line={trip.line} big />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold leading-tight text-text">
            {loading ? "Wczytywanie…" : direction || "—"}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {trip.isLive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-good/10 px-2 py-0.5 font-semibold text-good">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-good" aria-hidden />
                NA ŻYWO
              </span>
            ) : (
              <span className="rounded-full bg-white/6 px-2 py-0.5 font-semibold text-text-mute">
                ROZKŁADOWY
              </span>
            )}
            {trip.isLive && headerDelay != null && (
              <span className={`font-semibold tabular-nums ${delayClass(headerDelay)}`}>
                {delayTxt(headerDelay)}
              </span>
            )}
            {trip.note && (
              <span className="rounded-full bg-late/10 px-2 py-0.5 font-semibold text-late">
                {trip.note}
              </span>
            )}
            {loopStops.length > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-primary-dim px-2 py-0.5 font-semibold text-primary"
                title={`Kurs realizowany przez pętlę: ${loopStops.join(", ")}`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M17 3l4 4-4 4" />
                  <path d="M21 7H8a4 4 0 0 0 0 8h1" />
                  <path d="M7 21l-4-4 4-4" />
                  <path d="M3 17h13" />
                </svg>
                przez {loopStops.join(", ")}
              </span>
            )}
            {trip.status === "routing" && (
              <span className="inline-flex items-center gap-1.5 text-text-faint">
                <Spinner /> wyznaczanie trasy…
              </span>
            )}
          </div>
        </div>
        <IconButton label="Zamknij trasę" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
      {eta && (
        <p className="mt-2.5 rounded-xl bg-white/4 px-3 py-2 text-[12px] tabular-nums text-text-mute" aria-live="polite">
          {eta}
        </p>
      )}
    </header>
  );

  return (
    <BottomSheet
      desktop={desktop}
      onClose={onClose}
      ariaLabel={`Trasa linii ${trip.line}`}
      header={header}
    >
      <div ref={scrollRef} className="kb-scroll h-full overflow-y-auto pb-5">
        {failed ? (
          <ErrorState onRetry={onRetry} />
        ) : loading ? (
          <TimelineSkeleton />
        ) : (
          <ol className="px-4 pt-1">
            {trip.rawTimes.map((t, idx) => {
              const isCurrent = trip.isLive && vti != null && idx === vti;
              const passed = trip.isLive && vti != null && idx < vti;
              const diff = t.estimate?.time_diff ?? null;
              const planned = secsFromHHMM(t.departure_time);
              const est = trip.isLive && diff != null && planned != null;
              const shown = est ? hhmmFromSecs((planned as number) + (diff as number)) : t.departure_time;
              const bigDiff = est && Math.abs(diff as number) > 60;
              const selected =
                !!trip.stop &&
                ((t.designator != null && String(t.designator) === String(trip.stop.id)) ||
                  t.place_id === trip.stop.designator);
              const coord = stopByIndex.get(t.index);
              const first = idx === 0;
              const last = idx === trip.rawTimes.length - 1;
              return (
                <li key={`${t.index}-${idx}`} ref={isCurrent ? currentRef : undefined}>
                  <button
                    type="button"
                    disabled={!coord}
                    onClick={() => coord && onFocusStop(coord)}
                    className={`flex w-full items-stretch gap-3 rounded-2xl text-left transition-colors ${
                      coord ? "hover:bg-white/5 active:bg-white/8" : ""
                    } ${selected ? "bg-primary-dim" : ""}`}
                  >
                    {/* time */}
                    <span
                      className={`w-12 shrink-0 self-center pl-1 text-right text-[13px] font-semibold tabular-nums ${
                        passed ? "text-text-faint" : est ? delayClass(diff) : "text-text"
                      }`}
                    >
                      {shown}
                    </span>

                    {/* timeline node */}
                    <span className="relative w-5 shrink-0 self-stretch" aria-hidden>
                      {!first && (
                        <span
                          className="absolute left-1/2 top-0 h-1/2 w-[3px] -translate-x-1/2"
                          style={{ background: passed || isCurrent ? "rgba(255,255,255,0.18)" : lineColor }}
                        />
                      )}
                      {!last && (
                        <span
                          className="absolute bottom-0 left-1/2 h-1/2 w-[3px] -translate-x-1/2"
                          style={{ background: passed ? "rgba(255,255,255,0.18)" : lineColor }}
                        />
                      )}
                      {isCurrent ? (
                        <span
                          className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-pulse-dot rounded-full border-[3px] border-white"
                          style={{ background: lineColor }}
                        />
                      ) : (
                        <span
                          className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                          style={{
                            borderColor: passed ? "rgba(255,255,255,0.25)" : lineColor,
                            background: passed ? "transparent" : "var(--color-surface)",
                          }}
                        />
                      )}
                    </span>

                    {/* name */}
                    <span className="min-w-0 flex-1 self-center py-3">
                      <span
                        className={`block truncate text-[13.5px] ${
                          isCurrent
                            ? "font-bold text-text"
                            : passed
                              ? "text-text-faint"
                              : selected
                                ? "font-semibold text-text"
                                : "font-medium text-text"
                        }`}
                      >
                        {t.stop_name}
                      </span>
                      {(t.platform || bigDiff) && (
                        <span className="mt-0.5 block text-[11px] text-text-faint">
                          {bigDiff ? <s className="tabular-nums">plan {t.departure_time}</s> : null}
                          {bigDiff && t.platform ? " · " : ""}
                          {t.platform ? `peron ${t.platform}` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </BottomSheet>
  );
}

export default memo(TripView);
