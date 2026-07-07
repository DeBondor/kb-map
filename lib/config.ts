/**
 * Central configuration — TypeScript port of kb_gtfs/config.py.
 *
 * Every value can be overridden with a KB_* environment variable; the
 * defaults match the Python originals exactly.
 */
import path from "node:path";

/** Read a string env var, falling back to `def` when unset or empty. */
function envStr(name: string, def: string): string {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : def;
}

/** Read an integer env var, falling back to `def` when unset/invalid. */
function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export const BASE_URL = envStr("KB_BASE_URL", "https://komunikacjabeskidzka.kiedyprzyjedzie.pl");
export const AGENCY_NAME = envStr("KB_AGENCY_NAME", "Komunikacja Beskidzka S.A.");
export const AGENCY_ID = envStr("KB_AGENCY_ID", "KB");
export const AGENCY_URL = envStr("KB_AGENCY_URL", "https://komunikacjabeskidzka.kiedyprzyjedzie.pl");
export const AGENCY_TIMEZONE = envStr("KB_AGENCY_TIMEZONE", "Europe/Warsaw");
export const AGENCY_LANG = envStr("KB_AGENCY_LANG", "pl");

export const DEFAULT_STOPS_REVISION = envStr("KB_STOPS_REVISION", "6829");

/** Output paths, relative to the process working directory. */
export const OUTPUT_DIR = envStr("KB_OUTPUT_DIR", path.join(process.cwd(), "output"));
export const GTFS_DIR = envStr("KB_GTFS_DIR", path.join(OUTPUT_DIR, "gtfs"));
export const RT_DIR = envStr("KB_RT_DIR", path.join(OUTPUT_DIR, "rt"));

/** HTTP timeout in seconds (aiohttp "total" equivalent). */
export const HTTP_TIMEOUT = envInt("KB_HTTP_TIMEOUT", 20);
export const DEFAULT_CONCURRENCY = envInt("KB_CONCURRENCY", 40);

/** Live poller tuning (all in seconds unless noted). */
export const LIVE_FULL_SCAN_INTERVAL = envInt("KB_SCAN_INTERVAL", 180);
export const LIVE_REFRESH_INTERVAL = envInt("KB_REFRESH_INTERVAL", 15);
export const LIVE_CANDIDATE_HORIZON_SEC = envInt("KB_CANDIDATE_HORIZON", 7200);
export const LIVE_404_CACHE_SEC = envInt("KB_404_CACHE", 240);
export const LIVE_STOP_EMPTY_CACHE_SEC = envInt("KB_STOP_EMPTY_CACHE", 600);
export const LIVE_STOP_FAR_CACHE_SEC = envInt("KB_STOP_FAR_CACHE", 300);
export const LIVE_STOP_FAR_THRESHOLD_SEC = envInt("KB_STOP_FAR_THRESHOLD", 1800);
export const LIVE_SMART_SCAN_INTERVAL = envInt("KB_SMART_SCAN_INTERVAL", 60);
export const LIVE_SMART_SCAN_WINDOW_SEC = envInt("KB_SMART_SCAN_WINDOW", 600);
export const LIVE_BATCH_SIZE = envInt("KB_BATCH_SIZE", 100);

/**
 * Stale-vehicle ("ghost") filter. The upstream keeps returning a vehicle's
 * last-known position after it stops transmitting, so a bus that finished /
 * lost its feed lingers frozen on the map with no delay. We hide a vehicle once
 * it has not moved more than STALE_MOVE_EPS metres for STALE_VEHICLE seconds AND
 * has no live delay estimate. Real GPS always jitters, so a position that stays
 * put this long is a frozen feed, not a parked-but-live bus.
 */
export const LIVE_STALE_VEHICLE_SEC = envInt("KB_STALE_VEHICLE_SEC", 300);
export const LIVE_STALE_MOVE_EPS_M = envInt("KB_STALE_MOVE_EPS_M", 15);

export const USER_AGENT = envStr(
  "KB_USER_AGENT",
  "kb-gtfs/1.0 (+https://komunikacjabeskidzka.kiedyprzyjedzie.pl)",
);

/** Map an upstream line type to a GTFS route_type (port of route_type_for). */
export function routeTypeFor(lineType: string | null | undefined, _vehicleType?: number | null): number {
  const t = (lineType ?? "").toLowerCase();
  if (t === "tram") return 0;
  if (t === "rail" || t === "train") return 2;
  if (t === "metro" || t === "subway") return 1;
  if (t === "ferry") return 4;
  if (t === "trolleybus" || t === "trolley") return 11;
  return 3;
}

/** Local-time "YYYY-MM-DD", matching Python's datetime.date.today().isoformat(). */
export function todayLocalISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
