import type { TripView, Vehicle } from "./types";

/** Komunikacja Beskidzka brand red. */
export const BRAND = "#a6192e";
export const ACCENT = "#ee7583";
export const COLOR_AT_STOP = "#34a370";
export const COLOR_LATE = "#e58f2a";
export const COLOR_EARLY = "#a86fdd";

/** Deterministic per-line color: h = (h*31 + charCode) % 360, s 58%, l 46%. */
export function hslColor(s: string | null | undefined): string {
  if (!s) return BRAND;
  const str = String(s);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return `hsl(${h},58%,46%)`;
}

/** Vehicle marker color: brand red in transit, status colors override. */
export function vehColor(v: Pick<Vehicle, "at_stop" | "delay" | "line">): string {
  if (v.at_stop) return COLOR_AT_STOP;
  if (v.delay != null && v.delay > 60) return COLOR_LATE;
  if (v.delay != null && v.delay < -60) return COLOR_EARLY;
  return BRAND;
}

export function secsFromHHMM(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const p = hhmm.split(":").map(Number);
  if (p.length < 2 || p.some((n) => Number.isNaN(n))) return null;
  return p[0] * 3600 + p[1] * 60 + (p[2] || 0);
}

export function hhmmFromSecs(s: number | null | undefined): string {
  if (s == null) return "";
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor(s / 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function nowSecs(): number {
  const n = new Date();
  return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
}

/** "o czasie" / "+X min" / "-X min" */
export function delayTxt(td: number | null | undefined): string {
  if (td == null) return "";
  // round the magnitude symmetrically so ±30 s render as mirror images
  // (plain Math.round rounds -0.5 to 0, making a 30 s-early bus read "o czasie")
  const m = Math.sign(td) * Math.round(Math.abs(td) / 60);
  if (m === 0) return "o czasie";
  return (m > 0 ? "+" : "") + m + " min";
}

/** Tailwind text-color class for a delay in seconds. */
export function delayClass(td: number | null | undefined): string {
  if (td == null) return "text-text-mute";
  if (td > 60) return "text-late";
  if (td < -60) return "text-early";
  return "text-good";
}

/** Countdown label for a departure at `secs` (seconds since midnight). */
export function countdown(secs: number | null, now: number): string {
  if (secs == null) return "";
  let delta = secs - now;
  // a departure upstream lists as 00:xx while `now` is still before midnight is
  // next-day, not ~24 h in the past — roll a large negative delta forward a day
  if (delta < -43200) delta += 86400;
  const mins = Math.round(delta / 60);
  if (mins <= 0) return "teraz";
  if (mins < 60) return `${mins} min`;
  return hhmmFromSecs(secs);
}

/** Diacritics-insensitive lowercase (handles Polish ł which NFD misses). */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function formatScan(lastScan: number | null | undefined, scanCount: number | null | undefined): string {
  if (!lastScan) return "—";
  const t = new Date(lastScan * 1000).toLocaleTimeString("pl-PL");
  return scanCount ? `${t} (#${scanCount})` : t;
}

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Names of the (few) stops a course detours through — a small spur visited
 * twice mid-route, like line 120's out-and-back to SZCZYRK BIŁA. Returns [] for
 * ordinary there-and-back round trips (which start and end at the same terminus
 * and double most of their stops) so the "przez …" badge only marks a genuine,
 * concise detour rather than listing a whole return leg.
 */
export function detectLoopStops(times: Array<{ stop_name: string }>): string[] {
  const n = times.length;
  if (n < 4) return [];
  // returns to where it started → round trip, not a notable via-detour
  const first = times[0]?.stop_name;
  const last = times[n - 1]?.stop_name;
  if (first && last && first === last) return [];
  const mid = new Map<string, number>();
  for (let i = 1; i < n - 1; i++) {
    const nm = times[i].stop_name;
    if (nm) mid.set(nm, (mid.get(nm) ?? 0) + 1);
  }
  const doubled: string[] = [];
  for (const [nm, c] of mid) if (c >= 2) doubled.push(nm);
  // a genuine spur doubles just a handful of stops; more than that means the
  // course backtracks over a long stretch (a there-and-back) → not a via-detour
  if (doubled.length === 0 || doubled.length > 3) return [];
  return doubled;
}

/** ETA line for the trip header — ported 1:1 from the original drawTrip(). */
export function computeEta(trip: TripView, now: number): string {
  const { stop, rawTimes, isLive, vti } = trip;
  let eta = "";
  if (stop) {
    const st = rawTimes.find(
      (t) =>
        (t.designator != null && String(t.designator) === String(stop.id)) ||
        t.place_id === stop.designator,
    );
    if (st) {
      const planned = secsFromHHMM(st.departure_time);
      const est = st.estimate?.time_diff;
      if (planned != null) {
        const arr = planned + (est ?? 0);
        let delta = arr - now;
        if (delta < -43200) delta += 86400; // post-midnight arrival viewed before midnight
        const mins = Math.round(delta / 60);
        eta = isLive
          ? `na ${stop.name}: ${hhmmFromSecs(arr)}${est != null ? ` (${delayTxt(est)})` : ""}`
          : `planowany przyjazd ${st.departure_time}`;
        if (isLive && mins >= 0) eta += ` · za ${mins} min`;
      }
    }
  }
  if (!eta && isLive && vti != null && rawTimes[vti]) eta = `pojazd na: ${rawTimes[vti].stop_name}`;
  return eta;
}
