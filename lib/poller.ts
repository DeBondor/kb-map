/**
 * Live vehicle-position poller — TypeScript port of kb_gtfs/rt/poller.py
 * (LivePoller) with full behavioral parity.
 */
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { transit_realtime } from "gtfs-realtime-bindings";

import * as config from "./config";
import { KbApi, asRecord, isRecord, parseIntStrict, pyTruthy } from "./kb-api";
import { log } from "./logger";
import type { Stop, VehicleJson, VehiclePos, VehiclesResponse } from "./types";

const rt = GtfsRealtimeBindings.transit_realtime;

/**
 * Rough bounding box of the Komunikacja Beskidzka network (Beskidy region:
 * Bielsko-Biała, Żywiec, Andrychów, Kęty, Szczyrk …). Upstream occasionally
 * reports a bogus (0, 0) fix — those land off the coast of Africa, so any
 * position outside this box is rejected as garbage.
 */
const SERVICE_AREA = { minLat: 48.8, maxLat: 50.5, minLon: 18.0, maxLon: 20.5 };
function inServiceArea(lat: number, lon: number): boolean {
  return (
    lat >= SERVICE_AREA.minLat &&
    lat <= SERVICE_AREA.maxLat &&
    lon >= SERVICE_AREA.minLon &&
    lon <= SERVICE_AREA.maxLon
  );
}

/**
 * Seconds since midnight in the agency's timezone (port of _now_secs). Uses
 * AGENCY_TIMEZONE explicitly instead of the process-local clock, so the schedule
 * math (delay, candidate horizon, finished) stays correct when the server runs
 * on UTC (the common container/cloud default) rather than Europe/Warsaw.
 */
export function nowSecs(): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: config.AGENCY_TIMEZONE,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date());
    let h = 0;
    let m = 0;
    let s = 0;
    for (const p of parts) {
      if (p.type === "hour") h = Number(p.value) % 24;
      else if (p.type === "minute") m = Number(p.value);
      else if (p.type === "second") s = Number(p.value);
    }
    return h * 3600 + m * 60 + s;
  } catch {
    const n = new Date();
    return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
  }
}

/** "HH:MM[:SS]" -> seconds since midnight, or null (port of _hhmm_to_secs). */
export function hhmmToSecs(hhmm: unknown): number | null {
  if (typeof hhmm !== "string" || hhmm === "" || !hhmm.includes(":")) return null;
  const parts = hhmm.split(":");
  if (parts.length < 2) return null;
  const h = parseIntStrict(parts[0]);
  const m = parseIntStrict(parts[1]);
  if (h === null || m === null) return null;
  return h * 3600 + m * 60;
}

/** Approximate metres between two nearby lat/lon points (planar, fine at city scale). */
export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111_320;
  const dLon = (lon2 - lon1) * 111_320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/** Initial great-circle bearing from point 1 to point 2, degrees [0, 360). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number | null {
  if (lat1 === lat2 && lon1 === lon2) return null;
  const rad = Math.PI / 180;
  const phi1 = lat1 * rad;
  const phi2 = lat2 * rad;
  const dlon = (lon2 - lon1) * rad;
  const x = Math.sin(dlon) * Math.cos(phi2);
  const y = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlon);
  const b = Math.atan2(x, y) / rad;
  return (b + 360.0) % 360.0;
}

/**
 * Parse a departures row's scheduled time into seconds since midnight.
 * "HH:MM" is absolute; "5 min" / "< 1 min" / null return null so the caller
 * treats the departure as imminent (port of _row_departure_secs).
 */
function rowDepartureSecs(row: Record<string, unknown>): number | null {
  for (const key of ["static_time", "time"]) {
    const val = row[key];
    if (typeof val === "string" && val.includes(":")) {
      const parts = val.split(":");
      if (parts.length >= 2) {
        const h = parseIntStrict(parts[0]);
        const m = parseIntStrict(parts[1]);
        if (h !== null && m !== null) return h * 3600 + m * 60;
      }
    }
  }
  return null;
}

/** Round half-ish like Python's round-for-display; adequate for coords. */
function roundTo(x: number, digits: number): number {
  return Number(x.toFixed(digits));
}

/** Python int(x or default) with a safety fallback. */
function toInt(v: unknown, def: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function isIdx(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/** VehiclePos -> wire JSON (port of VehiclePos.to_json). */
export function vehicleToJson(v: VehiclePos): VehicleJson {
  return {
    id: v.execId,
    trip_id: v.tripId,
    route_id: v.routeId,
    line: v.line,
    headsign: v.headsign,
    lat: roundTo(v.lat, 6),
    lon: roundTo(v.lon, 6),
    vehicle_type: v.vehicleType,
    current_stop_sequence: v.currentStopSequence,
    at_stop: v.atStop,
    delay: v.delay,
    bearing: v.bearing !== null ? roundTo(v.bearing, 1) : null,
    next_stop_name: v.nextStopName,
    next_stop_lat: v.nextStopLat !== null ? roundTo(v.nextStopLat, 6) : null,
    next_stop_lon: v.nextStopLon !== null ? roundTo(v.nextStopLon, 6) : null,
    timestamp: v.timestamp,
    updated_at: roundTo(v.updatedAt, 1),
  };
}

/** Sleep that resolves early (and clears its timer) when the signal aborts. */
function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    timer.unref?.();
    function done(): void {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort(): void {
      clearTimeout(timer);
      done();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface LivePollerOptions {
  scanInterval?: number;
  refreshInterval?: number;
  horizon?: number;
  cache404?: number;
  stopEmptyCache?: number;
  stopFarCache?: number;
  stopFarThreshold?: number;
  smartScanInterval?: number;
  smartScanWindow?: number;
  batchSize?: number;
}

interface ScanResult {
  /** exec_id -> earliest scheduled departure (secs since midnight) */
  perTrip: Map<string, number>;
  /** exec_id -> raw departure rows (kept for parity; unused downstream) */
  rowsByTrip: Map<string, Array<Record<string, unknown>>>;
}

/**
 * Continuously discovers active trip executions from stop departure boards
 * and polls their live vehicle positions.
 */
export class LivePoller {
  readonly api: KbApi;
  readonly scanInterval: number;
  readonly refreshInterval: number;
  readonly horizon: number;
  readonly cache404: number;
  readonly stopEmptyCache: number;
  readonly stopFarCache: number;
  readonly stopFarThreshold: number;
  readonly smartScanInterval: number;
  readonly smartScanWindow: number;
  readonly batchSize: number;

  stops: Stop[] = [];
  positions = new Map<string, VehiclePos>();
  lastScan = 0;
  lastRefresh = 0;
  scanCount = 0;

  /** exec_id -> epoch secs at which the 404 was observed. */
  private notFound = new Map<string, number>();
  /** stop url_id -> epoch secs before which the stop must not be rescanned. */
  private stopRescanAt = new Map<string, number>();
  /** stop url_id -> earliest scheduled departure (secs since midnight). */
  private stopEarliest = new Map<string, number>();
  private stopsById = new Map<number, Stop>();
  private stopsByUrlId = new Map<string, Stop>();

  private started = false;
  private stopCtl: AbortController | null = null;
  private runPromise: Promise<void> | null = null;

  constructor(api: KbApi, opts: LivePollerOptions = {}) {
    this.api = api;
    this.scanInterval = opts.scanInterval ?? config.LIVE_FULL_SCAN_INTERVAL;
    this.refreshInterval = opts.refreshInterval ?? config.LIVE_REFRESH_INTERVAL;
    this.horizon = opts.horizon ?? config.LIVE_CANDIDATE_HORIZON_SEC;
    this.cache404 = opts.cache404 ?? config.LIVE_404_CACHE_SEC;
    this.stopEmptyCache = opts.stopEmptyCache ?? config.LIVE_STOP_EMPTY_CACHE_SEC;
    this.stopFarCache = opts.stopFarCache ?? config.LIVE_STOP_FAR_CACHE_SEC;
    this.stopFarThreshold = opts.stopFarThreshold ?? config.LIVE_STOP_FAR_THRESHOLD_SEC;
    this.smartScanInterval = opts.smartScanInterval ?? config.LIVE_SMART_SCAN_INTERVAL;
    this.smartScanWindow = opts.smartScanWindow ?? config.LIVE_SMART_SCAN_WINDOW_SEC;
    this.batchSize = opts.batchSize ?? config.LIVE_BATCH_SIZE;
  }

  /** Load the current stops revision + stop list and build lookup maps. */
  async loadStops(): Promise<void> {
    const rev = await this.api.fetchRevision();
    this.stops = await this.api.fetchStops(rev);
    this.stopsById = new Map(this.stops.map((s) => [s.internalId, s]));
    this.stopsByUrlId = new Map(this.stops.map((s) => [s.urlId, s]));
  }

  /** Load stops and start the background polling loop (no-op when running). */
  async start(): Promise<void> {
    if (this.started) return;
    await this.loadStops();
    if (this.started) return;
    this.started = true;
    this.stopCtl = new AbortController();
    const signal = this.stopCtl.signal;
    this.runPromise = this.run(signal).catch((err: unknown) => {
      log.error("rt", `poller loop crashed: ${err}`);
    });
  }

  /** Stop the loop cleanly: aborts sleeps, leaves no dangling timers. */
  async stop(): Promise<void> {
    this.stopCtl?.abort();
    this.started = false;
    const p = this.runPromise;
    this.runPromise = null;
    if (p) await p;
  }

  /** Main loop: full scan every scanInterval; between scans, refresh every refreshInterval and smart-scan every smartScanInterval. */
  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.fullScan();
      } catch (err) {
        log.error("rt", `full scan error: ${err}`);
      }
      this.lastScan = Date.now() / 1000;
      this.scanCount += 1;
      const deadline = this.lastScan + this.scanInterval;
      let lastSmart = this.lastScan;
      while (Date.now() / 1000 < deadline && !signal.aborted) {
        const waitSecs = Math.min(this.refreshInterval, Math.max(1, deadline - Date.now() / 1000));
        await interruptibleSleep(waitSecs * 1000, signal);
        if (signal.aborted) break;
        const now = Date.now() / 1000;
        try {
          if (now - lastSmart >= this.smartScanInterval) {
            await this.smartScan();
            lastSmart = now;
          }
          await this.refreshActive();
        } catch (err) {
          log.error("rt", `refresh error: ${err}`);
        }
        this.lastRefresh = Date.now() / 1000;
      }
    }
  }

  /** Fetch departures for the given stops in batches and extract trip candidates (port of _scan_stops_batched). */
  private async scanStopsBatched(
    toScan: Stop[],
    now: number,
    nowTs: number,
    rescanOnEmpty: number,
  ): Promise<ScanResult> {
    const perTrip = new Map<string, number>();
    const rowsByTrip = new Map<string, Array<Record<string, unknown>>>();

    const ids = toScan.map((s) => s.urlId);
    const stopByUrl = new Map(toScan.map((s) => [s.urlId, s]));
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += this.batchSize) batches.push(ids.slice(i, i + this.batchSize));
    const results = await Promise.all(batches.map((b) => this.api.fetchMultipleDepartures(b)));

    for (let bi = 0; bi < batches.length; bi++) {
      const batchIds = batches[bi];
      const resp = results[bi];
      if (!pyTruthy(resp)) {
        for (const uid of batchIds) {
          const s = stopByUrl.get(uid)!;
          this.stopRescanAt.set(s.urlId, nowTs + rescanOnEmpty);
          this.stopEarliest.delete(s.urlId);
        }
        continue;
      }
      const depsByDesig = new Map<string, Record<string, unknown>>();
      const departures = asRecord(resp).departures;
      for (const depRaw of Array.isArray(departures) ? departures : []) {
        if (!isRecord(depRaw)) continue;
        const desig = depRaw.designator;
        if (desig !== null && desig !== undefined) depsByDesig.set(String(desig), depRaw);
      }

      for (const uid of batchIds) {
        const s = stopByUrl.get(uid)!;
        const depA = depsByDesig.get(s.stopId);
        const dep = pyTruthy(depA) ? depA : depsByDesig.get(uid);
        const rows = dep !== undefined ? dep.rows : undefined;
        if (dep === undefined || !pyTruthy(rows)) {
          this.stopRescanAt.set(s.urlId, nowTs + rescanOnEmpty);
          this.stopEarliest.delete(s.urlId);
          continue;
        }
        let earliest: number | null = null;
        for (const rowRaw of Array.isArray(rows) ? rows : []) {
          if (!isRecord(rowRaw)) continue;
          const eidRaw = rowRaw.trip_execution_id;
          if (!pyTruthy(eidRaw)) continue;
          const eid = String(eidRaw);
          let depSec = rowDepartureSecs(rowRaw);
          if (depSec === null) depSec = now;
          if (earliest === null || depSec < earliest) earliest = depSec;
          const cur = perTrip.get(eid);
          if (cur === undefined || depSec < cur) perTrip.set(eid, depSec);
          let bucket = rowsByTrip.get(eid);
          if (!bucket) {
            bucket = [];
            rowsByTrip.set(eid, bucket);
          }
          bucket.push(rowRaw);
        }
        if (earliest !== null) {
          this.stopEarliest.set(s.urlId, earliest);
          if (earliest > now + this.stopFarThreshold) {
            this.stopRescanAt.set(s.urlId, nowTs + this.stopFarCache);
          } else {
            this.stopRescanAt.set(s.urlId, nowTs);
          }
        } else {
          this.stopRescanAt.set(s.urlId, nowTs + rescanOnEmpty);
          this.stopEarliest.delete(s.urlId);
        }
      }
    }

    return { perTrip, rowsByTrip };
  }

  /** Scan all due stops for departures and fetch candidate positions (port of _full_scan). */
  private async fullScan(): Promise<void> {
    if (this.stops.length === 0) return;
    this.sweepExpired();
    const now = nowSecs();
    const nowTs = Date.now() / 1000;
    const toScan = this.stops.filter(
      (s) =>
        (this.stopRescanAt.get(s.urlId) ?? 0) <= nowTs ||
        (this.stopEarliest.get(s.urlId) ?? 999999) <= now + this.horizon,
    );
    const nBatches = toScan.length > 0 ? Math.ceil(toScan.length / this.batchSize) : 0;
    log.info(
      "rt",
      `full scan: ${toScan.length}/${this.stops.length} stops in ${nBatches} batches (cached ${this.stops.length - toScan.length}), now=${now}s`,
    );

    if (toScan.length === 0) {
      log.info("rt", `all stops cached, ${this.positions.size} active`);
      return;
    }

    const { perTrip, rowsByTrip } = await this.scanStopsBatched(toScan, now, nowTs, this.stopEmptyCache);

    const candidates: Array<[string, number]> = [...perTrip.entries()].filter(([, mnd]) => mnd <= now + this.horizon);
    log.info("rt", `discovered ${perTrip.size} trips, ${candidates.length} candidates (${this.positions.size} active)`);

    await this.fetchPositions(candidates, rowsByTrip);
  }

  /** Re-scan only stops with imminent departures (port of _smart_scan). */
  private async smartScan(): Promise<void> {
    if (this.stops.length === 0) return;
    const now = nowSecs();
    const nowTs = Date.now() / 1000;
    const toScan = this.stops.filter(
      (s) =>
        (this.stopEarliest.get(s.urlId) ?? 999999) <= now + this.smartScanWindow &&
        (this.stopRescanAt.get(s.urlId) ?? 0) <= nowTs,
    );
    if (toScan.length === 0) return;
    const nBatches = Math.ceil(toScan.length / this.batchSize);
    log.info("rt", `smart scan: ${toScan.length} stops in ${nBatches} batches (departures within ${this.smartScanWindow}s)`);

    const { perTrip, rowsByTrip } = await this.scanStopsBatched(toScan, now, nowTs, this.smartScanInterval);

    const candidates: Array<[string, number]> = [...perTrip.entries()].filter(([, mnd]) => mnd <= now + this.horizon);
    if (candidates.length > 0) {
      await this.fetchPositions(candidates, rowsByTrip);
    }
  }

  /** Re-fetch positions of all currently tracked vehicles (port of _refresh_active). */
  private async refreshActive(): Promise<void> {
    if (this.positions.size === 0) return;
    const active = [...this.positions.keys()];
    await this.fetchPositions(
      active.map((eid): [string, number] => [eid, 0]),
      new Map(),
    );
  }

  /** Fetch trip executions for candidates, honoring the 404 cache (port of _fetch_positions). */
  private async fetchPositions(
    candidates: Array<[string, number]>,
    _rowsByTrip: Map<string, Array<Record<string, unknown>>>,
  ): Promise<void> {
    const nowTs = Math.floor(Date.now() / 1000);
    const cacheCut = nowTs - this.cache404;

    const results = await Promise.all(
      candidates.map(async ([eid]): Promise<[string, unknown, boolean]> => {
        const nf = this.notFound.get(eid);
        // cached 404 still fresh → skip the fetch, but DON'T re-stamp it below;
        // re-stamping every scan would slide the TTL forever (scanInterval <
        // cache404) and permanently hide a bus that 404'd once (dispatched late).
        if (nf !== undefined && nf > cacheCut && !this.positions.has(eid)) return [eid, null, false];
        return [eid, await this.api.fetchTripExecution(eid, 0), true];
      }),
    );

    for (const [eid, resp, fetched] of results) {
      if (!fetched) continue; // cached 404 skip: leave the original timestamp to age out
      if (!pyTruthy(resp)) {
        this.notFound.set(eid, nowTs);
        this.positions.delete(eid);
        continue;
      }
      const pos = this.parsePosition(eid, asRecord(resp));
      if (pos) {
        // Carry the movement anchor across refreshes: reset it (and mark "moved
        // now") only when the vehicle has travelled past the epsilon; otherwise
        // keep the previous anchor so a slowly-drifting bus still counts as
        // moving while a bit-frozen feed accrues stale time.
        const prev = this.positions.get(eid);
        if (prev) {
          const moved = metersBetween(pos.lat, pos.lon, prev.anchorLat, prev.anchorLon);
          if (moved > config.LIVE_STALE_MOVE_EPS_M) {
            pos.anchorLat = pos.lat;
            pos.anchorLon = pos.lon;
            pos.lastMovedAt = pos.updatedAt;
          } else {
            pos.anchorLat = prev.anchorLat;
            pos.anchorLon = prev.anchorLon;
            pos.lastMovedAt = prev.lastMovedAt;
          }
        }
        this.positions.set(eid, pos);
        this.notFound.delete(eid);
      }
    }

    this.pruneDead(Date.now() / 1000);
  }

  /**
   * Drop vehicles that are no longer live so both `positions` and the
   * refreshActive() workload stay bounded to actually-running buses:
   *  - finished (sitting at/past the last stop),
   *  - a frozen feed (isStale: no delay estimate and not moving),
   *  - not successfully parsed for a long time (e.g. persistent (0,0)/out-of-area
   *    fixes leave the old entry unchanged so updatedAt stops advancing).
   * Upstream keeps returning a dead trip's last position instead of 404ing, so
   * without this they would accumulate all service day and be re-polled forever.
   */
  private pruneDead(nowEpoch: number): void {
    const hardMax = config.LIVE_STALE_VEHICLE_SEC * 3;
    for (const [eid, v] of this.positions) {
      if (v.finished || this.isStale(v, nowEpoch) || nowEpoch - v.updatedAt > hardMax) {
        this.positions.delete(eid);
      }
    }
  }

  /** Evict expired 404 markers (keyed by unique per-day exec_id) so the
   *  notFound map doesn't accumulate every never-dispatched trip over time. */
  private sweepExpired(): void {
    const cut = Math.floor(Date.now() / 1000) - this.cache404;
    for (const [eid, ts] of this.notFound) if (ts <= cut) this.notFound.delete(eid);
  }

  /** Resolve lat/lon for a trip time entry from the loaded stops (port of _stop_coords). */
  private stopCoords(t: Record<string, unknown>): [number, number] | null {
    const desig = t.designator;
    if (isIdx(desig)) {
      const s = this.stopsById.get(desig);
      if (s) return [s.lat, s.lon];
    }
    const pid = t.place_id;
    if (typeof pid === "string") {
      const s = this.stopsByUrlId.get(pid);
      if (s) return [s.lat, s.lon];
    }
    return null;
  }

  /** Exact port of _parse_position: delay, bearing, next stop, trip id fallbacks. */
  private parsePosition(eid: string, resp: Record<string, unknown>): VehiclePos | null {
    const trip = asRecord(resp.trip);
    const vehicle = asRecord(resp.vehicle);
    const latRaw = vehicle.lat;
    const lonRaw = vehicle.lon;
    if (latRaw === null || latRaw === undefined || lonRaw === null || lonRaw === undefined) return null;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // drop bogus fixes (e.g. upstream's (0, 0)) so no bus teleports to the ocean
    if (!inServiceArea(lat, lon)) return null;

    const line = asRecord(trip.line);
    const lineName = pyTruthy(line.name) ? String(line.name) : "";
    const times: unknown[] = Array.isArray(trip.times) ? trip.times : [];
    const vti = resp.vehicle_trip_index;
    const ndi = resp.next_departure_index;
    const atStop = pyTruthy(resp.at_stop);

    // ---- delay from estimates[0].arrival_abs vs scheduled departure ----
    let delay: number | null = null;
    let ests: unknown = resp.estimates;
    let targetIdx: number | null = null;
    if (isIdx(ndi) && ndi >= 0 && ndi < times.length) targetIdx = ndi;
    if (targetIdx === null && isIdx(vti) && vti >= 0 && vti < times.length) targetIdx = vti;
    if (isRecord(ests)) ests = [ests];
    if (Array.isArray(ests) && ests.length > 0 && targetIdx !== null) {
      const first = asRecord(ests[0]);
      const arr = first.arrival_abs;
      const entry = times[targetIdx];
      const sched = isRecord(entry) ? hhmmToSecs(entry.departure_time) : null;
      const arrSec = hhmmToSecs(arr);
      if (arrSec !== null && sched !== null) {
        let raw = arrSec - sched;
        // wrap around midnight
        if (raw > 43200) raw -= 86400;
        else if (raw < -43200) raw += 86400;
        delay = Math.trunc(raw);
      }
    }
    // fallback: per-stop estimate.time_diff on the current time entry
    if (delay === null && isIdx(vti) && vti >= 0 && vti < times.length) {
      const entry = times[vti];
      if (isRecord(entry)) {
        const est = asRecord(entry.estimate);
        const td = est.time_diff;
        if (typeof td === "number" && Number.isFinite(td)) delay = Math.trunc(td);
      }
    }

    // ---- bearing toward the next stop ----
    let brg: number | null = null;
    let nextName: string | null = null;
    let nextLat: number | null = null;
    let nextLon: number | null = null;
    if (targetIdx !== null) {
      // when stopped at the stop, point toward the following one
      const idx = atStop && isIdx(vti) && targetIdx === vti ? targetIdx + 1 : targetIdx;
      if (idx >= 0 && idx < times.length) {
        const entry = times[idx];
        if (isRecord(entry)) {
          const c = this.stopCoords(entry);
          if (c !== null) {
            const [clat, clon] = c;
            const b = bearing(lat, lon, clat, clon);
            if (b !== null) {
              brg = b;
              nextName = pyTruthy(entry.stop_name) ? String(entry.stop_name) : "";
              nextLat = clat;
              nextLon = clon;
            }
          }
        }
      }
    }

    let tripId = "";
    if (isIdx(vti) && vti >= 0 && vti < times.length) {
      const entry = times[vti];
      if (isRecord(entry)) {
        const cand = pyTruthy(entry.trip_id) ? entry.trip_id : pyTruthy(resp.trip_id) ? resp.trip_id : "";
        tripId = String(cand);
      }
    }
    if (!tripId) {
      // Mirrors Python's precedence: str((resp["trip_id"] or eid.split(":")[1]) if ":" in eid else eid)
      tripId = eid.includes(":") ? String(pyTruthy(resp.trip_id) ? resp.trip_id : eid.split(":")[1]) : eid;
    }

    const vtVal = pyTruthy(resp.vehicle_type) ? resp.vehicle_type : pyTruthy(trip.vehicle_type) ? trip.vehicle_type : 0;
    const tsVal = pyTruthy(resp.timestamp) ? resp.timestamp : null;
    const nowEpoch = Date.now() / 1000;
    // course over once the bus is sitting at (or past) its last scheduled stop:
    // upstream keeps reporting it there with a delay that only grows, so hide it
    const lastIdx = times.length - 1;
    const finished = isIdx(vti) && lastIdx >= 0 && vti >= lastIdx && atStop;
    return {
      execId: eid,
      tripId,
      routeId: lineName ? "L_" + lineName : "",
      line: lineName,
      headsign: pyTruthy(trip.direction) ? String(trip.direction) : "",
      lat,
      lon,
      vehicleType: toInt(vtVal, 0),
      currentStopSequence: toInt(pyTruthy(vti) ? vti : 0, 0),
      atStop,
      delay,
      timestamp: tsVal !== null ? toInt(tsVal, Math.floor(nowEpoch)) : Math.floor(nowEpoch),
      updatedAt: nowEpoch,
      bearing: brg,
      nextStopName: nextName,
      nextStopLat: nextLat,
      nextStopLon: nextLon,
      // movement defaults; fetchPositions carries the anchor across refreshes
      lastMovedAt: nowEpoch,
      anchorLat: lat,
      anchorLon: lon,
      finished,
    };
  }

  /** A vehicle whose feed has frozen: no live delay estimate and not moving. */
  private isStale(v: VehiclePos, nowEpoch: number): boolean {
    return v.delay === null && nowEpoch - v.lastMovedAt > config.LIVE_STALE_VEHICLE_SEC;
  }

  /** Live vehicles shown on the map: not frozen (stale feed) and not finished. */
  private liveVehicles(nowEpoch: number): VehiclePos[] {
    return [...this.positions.values()].filter((v) => !v.finished && !this.isStale(v, nowEpoch));
  }

  /** Count of vehicles currently shown on the map (excludes frozen ghosts). */
  liveCount(): number {
    return this.liveVehicles(Date.now() / 1000).length;
  }

  /** Snapshot of all live vehicles for GET /api/vehicles (frozen ghosts hidden). */
  toJson(): VehiclesResponse {
    const live = this.liveVehicles(Date.now() / 1000);
    return {
      timestamp: Math.floor(Date.now() / 1000),
      scan_count: this.scanCount,
      last_scan: this.lastScan,
      count: live.length,
      vehicles: live.map(vehicleToJson),
    };
  }

  /** GTFS-Realtime VehiclePositions FeedMessage (binary; frozen ghosts hidden). */
  toProtobuf(): Uint8Array {
    const entity: transit_realtime.IFeedEntity[] = [];
    for (const v of this.liveVehicles(Date.now() / 1000)) {
      const vehicle: transit_realtime.IVehiclePosition = {
        position: {
          latitude: v.lat,
          longitude: v.lon,
          ...(v.bearing !== null ? { bearing: v.bearing } : {}),
        },
        timestamp: v.timestamp,
        trip: {
          ...(v.routeId ? { routeId: v.routeId } : {}),
          ...(v.tripId ? { tripId: v.tripId } : {}),
          scheduleRelationship: rt.TripDescriptor.ScheduleRelationship.SCHEDULED,
        },
        currentStopSequence: v.currentStopSequence,
        currentStatus: v.atStop
          ? rt.VehiclePosition.VehicleStopStatus.STOPPED_AT
          : rt.VehiclePosition.VehicleStopStatus.IN_TRANSIT_TO,
        vehicle: {
          ...(v.line ? { label: v.line } : {}),
          id: v.execId,
        },
      };
      entity.push({ id: v.execId, vehicle });
    }
    const message: transit_realtime.IFeedMessage = {
      header: {
        gtfsRealtimeVersion: "2.0",
        incrementality: rt.FeedHeader.Incrementality.FULL_DATASET,
        timestamp: Math.floor(Date.now() / 1000),
      },
      entity,
    };
    return rt.FeedMessage.encode(message).finish();
  }
}
