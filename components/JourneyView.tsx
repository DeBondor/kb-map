"use client";

import { memo, useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import { BackIcon, CloseIcon, IconButton, LineBadge } from "@/components/ui";
import { displayStopName, hslColor, przystanekPlural } from "@/lib/client/format";
import type { JourneyView as JourneyViewState } from "@/lib/client/types";

interface Props {
  journey: JourneyViewState;
  desktop: boolean;
  onClose: () => void;
  onBackToSearch: () => void;
  onSelectLeg: (legIdx: number | null) => void;
  onFocusStop: (lat: number, lon: number) => void;
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

function JourneyView({
  journey,
  desktop,
  onClose,
  onBackToSearch,
  onSelectLeg,
  onFocusStop,
}: Props) {
  const [expandedLegs, setExpandedLegs] = useState<Record<number, boolean>>({});

  const toggleLegExpand = (lIdx: number) => {
    setExpandedLegs((prev) => ({ ...prev, [lIdx]: !prev[lIdx] }));
  };

  const itinerary = journey.itinerary;
  const legs = itinerary.legs;
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];

  const fromTitle = firstLeg?.fromStopName || "Początek";
  const toTitle = lastLeg?.toStopName || "Koniec";

  const selectedLegIdx = journey.selectedLegIdx;

  const header = (
    <div>
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <IconButton onClick={onBackToSearch} label="Wróć do wyników wyszukiwania">
            <BackIcon />
          </IconButton>
          <div>
            <h2 className="text-sm font-bold text-text truncate max-w-[220px] sm:max-w-[320px]">
              {displayStopName(fromTitle)} → {displayStopName(toTitle)}
            </h2>
            <div className="flex items-center gap-2 text-xs text-text-mute">
              <span className="font-semibold text-text tabular-nums">
                {itinerary.departureTime} – {itinerary.arrivalTime}
              </span>
              <span>·</span>
              <span className="tabular-nums">{itinerary.totalDurationMins} min</span>
              {itinerary.dayLabel && (
                <>
                  <span>·</span>
                  <span className="text-brand font-medium">{itinerary.dayLabel}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <IconButton onClick={onClose} label="Zamknij widok trasy">
          <CloseIcon />
        </IconButton>
      </div>

      {/* Segment Selector Tabs ("Cała trasa" | "1. Linia X" | "2. Linia Y") */}
      <div className="flex items-center gap-1.5 border-b border-hairline px-4 py-2 bg-white/2 overflow-x-auto no-scrollbar sm:px-5">
        <button
          type="button"
          onClick={() => onSelectLeg(null)}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
            selectedLegIdx === null
              ? "bg-brand text-on-brand shadow-sm"
              : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text"
          }`}
        >
          Cała trasa ({legs.length > 1 ? `${legs.length} linie` : "1 linia"})
        </button>

        {legs.map((leg, lIdx) => (
          <button
            key={`tab-leg-${lIdx}`}
            type="button"
            onClick={() => onSelectLeg(lIdx)}
            className={`flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              selectedLegIdx === lIdx
                ? "bg-brand text-on-brand shadow-sm"
                : "bg-white/6 text-text-mute hover:bg-white/10 hover:text-text"
            }`}
          >
            <span>{lIdx + 1}.</span>
            <LineBadge line={leg.line} />
            <span className="text-[11px] opacity-80">{leg.durationMins}m</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <BottomSheet
      desktop={desktop}
      onClose={onClose}
      ariaLabel={`Trasa połączenia ${fromTitle} do ${toTitle}`}
      initialSnap="half"
      header={header}
    >
      {/* Timeline of legs and transfers */}
      <div
        className="divide-y divide-hairline px-4 py-3 sm:px-5 space-y-4 overflow-y-auto h-full"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        {legs.map((leg, lIdx) => {
          const color = hslColor(leg.line);
          const isExpanded = !!expandedLegs[lIdx];
          const isSelected = selectedLegIdx === null || selectedLegIdx === lIdx;
          const stops = leg.stops ?? [];
          const intermediateStops = stops.slice(1, -1);

          return (
            <div
              key={`leg-card-${lIdx}`}
              className={`pt-3 first:pt-0 transition-opacity ${isSelected ? "opacity-100" : "opacity-60"}`}
            >
              {/* Leg header */}
              <div className="rounded-xl bg-white/4 p-3 border border-white/6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-text-mute">
                      {lIdx + 1}
                    </span>
                    <LineBadge line={leg.line} />
                    <span className="font-semibold text-xs text-text truncate max-w-[180px] sm:max-w-[260px]">
                      {displayStopName(leg.headsign)}
                    </span>
                  </div>
                  <span className="tabular-nums text-xs text-text-mute font-medium">
                    {leg.durationMins} min · {leg.stopsCount} {przystanekPlural(leg.stopsCount)}
                  </span>
                </div>

                {/* Departure & Arrival summary points */}
                <div className="mt-3 space-y-2 border-l-2 pl-3 ml-1.5" style={{ borderColor: color }}>
                  {/* Boarding stop */}
                  <div
                    className="cursor-pointer hover:underline text-xs"
                    onClick={() => {
                      const s = stops[0];
                      if (s?.lat && s?.lon) onFocusStop(s.lat, s.lon);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-text">{displayStopName(leg.fromStopName)}</div>
                      <strong className="tabular-nums text-text font-bold ml-2">{leg.departureTime}</strong>
                    </div>
                    <div className="text-[10px] text-text-faint">Odjazd z przystanku</div>
                  </div>

                  {/* Expandable intermediate stops list */}
                  {intermediateStops.length > 0 && (
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={() => toggleLegExpand(lIdx)}
                        className="flex items-center gap-1.5 text-[11px] font-medium text-text-mute hover:text-text transition-colors py-0.5"
                      >
                        <span>
                          {isExpanded
                            ? "Ukryj przystanki pośrednie"
                            : `Pokaż ${intermediateStops.length} ${przystanekPlural(intermediateStops.length)} pośrednich`}
                        </span>
                        <ChevronDown open={isExpanded} />
                      </button>

                      {isExpanded && (
                        <div className="mt-2 space-y-1.5 border-l border-white/10 pl-2 ml-1 text-[11px]">
                          {intermediateStops.map((st, sIdx) => (
                            <div
                              key={`int-stop-${sIdx}`}
                              onClick={() => {
                                if (st.lat && st.lon) onFocusStop(st.lat, st.lon);
                              }}
                              className="flex items-center justify-between text-text-mute hover:text-text cursor-pointer transition-colors py-0.5"
                            >
                              <span className="truncate max-w-[200px]">{displayStopName(st.stopName)}</span>
                              <span className="tabular-nums text-[10px] text-text-faint ml-2">
                                {st.arrivalTime || st.departureTime}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Alighting stop */}
                  <div
                    className="cursor-pointer hover:underline text-xs"
                    onClick={() => {
                      const s = stops[stops.length - 1];
                      if (s?.lat && s?.lon) onFocusStop(s.lat, s.lon);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-text">{displayStopName(leg.toStopName)}</div>
                      <strong className="tabular-nums text-text font-bold ml-2">{leg.arrivalTime}</strong>
                    </div>
                    <div className="text-[10px] text-text-faint">Przyjazd na przystanek</div>
                  </div>
                </div>
              </div>

              {/* Transfer block if there is a next leg */}
              {lIdx < legs.length - 1 && (
                <div className="my-2.5 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-amber-300">
                      Przesiadka na przystanku: {displayStopName(leg.toStopName)}
                    </div>
                    <div className="text-[11px] text-amber-200/80">
                      Czas na przesiadkę: <strong>{legs[lIdx + 1] ? Math.max(1, Math.round((legs[lIdx + 1].departureSecs - leg.arrivalSecs) / 60)) : itinerary.transferWaitMins ?? 5} min</strong> · kolejny odjazd o {legs[lIdx + 1]?.departureTime}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Footer actions */}
        <div className="pt-3 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-hairline">
          <button
            type="button"
            onClick={onBackToSearch}
            className="w-full sm:w-auto rounded-xl bg-white/8 px-4 py-2 text-xs font-semibold text-text hover:bg-white/12 active:scale-95 transition-all text-center"
          >
            ← Wróć do listy połączeń
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-on-brand hover:brightness-110 active:scale-95 transition-all text-center"
          >
            Zamknij widok trasy
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

export default memo(JourneyView);
