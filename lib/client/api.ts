import type { LatLng, Trip } from "./types";

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new HttpError(r.status, url);
  return (await r.json()) as T;
}

/** SWR fetcher — always bypass the HTTP cache. */
export const swrFetcher = <T>(url: string): Promise<T> => fetchJSON<T>(url, { cache: "no-store" });

/* ---------- trip cache (dedupes concurrent + repeated fetches) ---------- */

/** Cap a Map to `max` entries, evicting oldest-inserted keys (cheap FIFO). */
function capMap<V>(m: Map<string, V>, max: number): void {
  if (m.size <= max) return;
  for (const k of m.keys()) {
    if (m.size <= max) break;
    m.delete(k);
  }
}

const tripCache = new Map<string, Promise<Trip | null>>();
const TRIP_CACHE_MAX = 300;

export function getTrip(tripId: string | number, signal?: AbortSignal): Promise<Trip | null> {
  const key = String(tripId);
  const hit = tripCache.get(key);
  if (hit) return hit;
  // This promise is SHARED by every concurrent caller. Never let it reject: a
  // rethrown AbortError from the first caller's signal would poison the promise
  // for everyone else awaiting it (e.g. leaving MapApp's trip stuck loading).
  // Resolve null on any error/abort and drop the key so a later caller retries.
  const p = fetchJSON<Trip>(`/api/trip/${encodeURIComponent(key)}`, { signal, cache: "no-store" }).catch(
    () => {
      tripCache.delete(key);
      return null;
    },
  );
  tripCache.set(key, p);
  capMap(tripCache, TRIP_CACHE_MAX);
  return p;
}

/* ---------- OSRM road-following segments ---------- */

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const routeCache = new Map<string, Promise<LatLng[] | null>>();
const ROUTE_CACHE_MAX = 200;

interface OsrmResponse {
  routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>;
}

/**
 * Road geometry through all `points` ([lat, lon]) in ONE OSRM request — the
 * server snaps every waypoint and returns the whole driving line, so an N-stop
 * trip costs a single round-trip instead of N-1. Cached in memory (in-flight
 * included); resolves null when OSRM fails so the caller falls back to straight
 * lines. A transient failure is NOT pinned — the key is dropped so it retries.
 */
export function fetchRoute(points: LatLng[]): Promise<LatLng[] | null> {
  if (points.length < 2) return Promise.resolve(null);
  const key = points.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(";");
  const hit = routeCache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<LatLng[] | null> => {
    try {
      const coords = points.map((pt) => `${pt[1]},${pt[0]}`).join(";");
      const d = await fetchJSON<OsrmResponse>(`${OSRM}/${coords}?overview=full&geometries=geojson`);
      const line = d.routes?.[0]?.geometry?.coordinates;
      if (line && line.length) return line.map((c): LatLng => [c[1], c[0]]);
    } catch {
      // fall through — caller draws straight segments instead
    }
    routeCache.delete(key); // don't pin a transient OSRM failure for the whole session
    return null;
  })();
  routeCache.set(key, p);
  capMap(routeCache, ROUTE_CACHE_MAX);
  return p;
}
