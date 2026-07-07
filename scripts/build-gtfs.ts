/**
 * Build a static single-day GTFS feed — TypeScript port of kb_gtfs/build_gtfs.py.
 *
 * Usage:
 *   npm run build:gtfs -- --date 2026-07-05 --out output/gtfs --concurrency 40 --zip
 *   npm run build:gtfs -- --no-zip
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { zipSync } from "fflate";

import * as config from "../lib/config";
import { KbApi, pyTruthy } from "../lib/kb-api";
import type { Stop, Trip } from "../lib/types";

const WEEKDAY_FIELDS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

type Row = Record<string, string | number>;

/** Strip CR/LF and surrounding whitespace (port of _compact). */
function compact(s: unknown): string {
  return String(s ?? "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

/** "HH:MM" -> seconds since midnight, 0 when unparseable (port of _hhmm_to_seconds). */
function hhmmToSeconds(hhmm: string): number {
  if (!hhmm) return 0;
  const parts = hhmm.split(":");
  if (parts.length < 2) return 0;
  const h = parts[0].trim();
  const m = parts[1].trim();
  if (!/^[+-]?\d+$/.test(h) || !/^[+-]?\d+$/.test(m)) return 0;
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60;
}

/** "HH:MM" -> "HH:MM:SS"; unparseable-but-nonempty values pass through (port of _fmt_time). */
function fmtTime(hhmm: string): string {
  const secs = hhmmToSeconds(hhmm);
  if (secs <= 0 && hhmm) return hhmm;
  const h = Math.floor(secs / 3600);
  const rem = secs % 3600;
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}

const COORD_KEYS = new Set(["shape_pt_lat", "shape_pt_lon", "stop_lat", "stop_lon"]);

/** RFC 4180 field escaping: quote when the field contains , " CR or LF. */
function csvField(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Port of _write_csv: UTF-8 without BOM, LF line endings, same value coercion. */
function writeCsv(filePath: string, fieldnames: string[], rows: Row[]): void {
  const lines: string[] = [fieldnames.map(csvField).join(",")];
  for (const r of rows) {
    const cells = fieldnames.map((k) => {
      const v = r[k] ?? "";
      let sv: string;
      if (typeof v === "number" && !COORD_KEYS.has(k)) sv = String(v);
      else if (COORD_KEYS.has(k) && v !== "") sv = String(v);
      else sv = v !== "" ? compact(String(v)) : "";
      return csvField(sv);
    });
    lines.push(cells.join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n", { encoding: "utf-8" });
}

/** Python date.weekday(): Monday=0 ... Sunday=6. Throws on invalid dates. */
function weekdayMonday0(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`invalid date: ${date} (expected YYYY-MM-DD)`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`invalid date: ${date}`);
  }
  return (dt.getUTCDay() + 6) % 7;
}

/** Port of _write_gtfs: same files, column orders and values. */
function writeGtfs(
  outDir: string,
  stops: Stop[],
  routes: Map<string, Row>,
  trips: Row[],
  stopTimes: Row[],
  shapes: Row[],
  date: string,
): void {
  const dateCompact = date.replace(/-/g, "");
  const weekday = weekdayMonday0(date);
  const flags: Row = {};
  WEEKDAY_FIELDS.forEach((f, i) => {
    flags[f] = i === weekday ? "1" : "0";
  });

  writeCsv(path.join(outDir, "agency.txt"), ["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"], [
    {
      agency_id: config.AGENCY_ID,
      agency_name: config.AGENCY_NAME,
      agency_url: config.AGENCY_URL,
      agency_timezone: config.AGENCY_TIMEZONE,
      agency_lang: config.AGENCY_LANG,
    },
  ]);

  const stopRows: Row[] = stops.map((s) => ({
    stop_id: s.stopId,
    stop_name: s.name,
    stop_lat: s.lat.toFixed(6),
    stop_lon: s.lon.toFixed(6),
    stop_url: "",
    location_type: s.isStation ? "1" : "0",
    parent_station: "",
    stop_timezone: "",
    wheelchair_boarding: "",
  }));
  writeCsv(
    path.join(outDir, "stops.txt"),
    ["stop_id", "stop_name", "stop_lat", "stop_lon", "stop_url", "location_type", "parent_station", "stop_timezone", "wheelchair_boarding"],
    stopRows,
  );

  const routeRows: Row[] = [...routes.values()].map((r) => ({
    ...r,
    route_desc: "",
    route_color: "",
    route_text_color: "",
  }));
  writeCsv(
    path.join(outDir, "routes.txt"),
    ["route_id", "agency_id", "route_short_name", "route_long_name", "route_desc", "route_type", "route_url", "route_color", "route_text_color"],
    routeRows,
  );

  writeCsv(
    path.join(outDir, "trips.txt"),
    ["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name", "direction_id", "block_id", "shape_id"],
    trips,
  );

  writeCsv(
    path.join(outDir, "stop_times.txt"),
    ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "stop_headsign", "pickup_type", "drop_off_type", "shape_dist_traveled"],
    stopTimes,
  );

  writeCsv(path.join(outDir, "calendar.txt"), ["service_id", ...WEEKDAY_FIELDS, "start_date", "end_date"], [
    { service_id: "KB_" + dateCompact, ...flags, start_date: dateCompact, end_date: dateCompact },
  ]);

  writeCsv(
    path.join(outDir, "shapes.txt"),
    ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"],
    shapes,
  );

  writeCsv(
    path.join(outDir, "feed_info.txt"),
    ["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"],
    [
      {
        feed_publisher_name: config.AGENCY_NAME,
        feed_publisher_url: config.AGENCY_URL,
        feed_lang: config.AGENCY_LANG,
        feed_start_date: dateCompact,
        feed_end_date: dateCompact,
        feed_version: `KB-GTFS ${date}`,
      },
    ],
  );
}

/** Port of build(): fetch stops + timetables + trips, emit GTFS files. */
async function build(date: string, outDir: string, concurrency: number, doZip: boolean): Promise<void> {
  // validate early, like Python's dt.date.fromisoformat in _write_gtfs
  weekdayMonday0(date);
  fs.mkdirSync(outDir, { recursive: true });

  const api = new KbApi({ concurrency });
  const rev = await api.fetchRevision();
  console.log(`[gtfs] stops revision: ${rev}`);
  const stops = await api.fetchStops(rev);
  console.log(`[gtfs] loaded ${stops.length} stops`);

  const stopByUrl = new Map(stops.map((s) => [s.urlId, s]));
  const stopById = new Map(stops.map((s) => [s.internalId, s]));

  console.log(`[gtfs] fetching timetables for ${stops.length} stops on ${date} ...`);
  const results = await api.fetchMany((s: Stop) => api.fetchTimetable(s.urlId, date), stops);

  const tripIds = new Set<string>();
  for (const [, tt] of results) {
    if (!pyTruthy(tt)) continue;
    const departures = (tt as Record<string, unknown>).departures;
    if (!Array.isArray(departures)) continue;
    for (const dep of departures) {
      if (dep === null || typeof dep !== "object") continue;
      const tid = (dep as Record<string, unknown>).trip_id;
      if (tid !== null && tid !== undefined) tripIds.add(String(tid));
    }
  }
  console.log(`[gtfs] discovered ${tripIds.size} unique trips`);

  console.log(`[gtfs] fetching trip details ...`);
  const tripResults = await api.fetchMany((t: string) => api.fetchTrip(t, 0), [...tripIds].sort());

  const routes = new Map<string, Row>();
  const shapesRows: Row[] = [];
  const stopTimesRows: Row[] = [];
  const tripsRows: Row[] = [];
  const seenTrips = new Set<string>();

  for (const [, trip] of tripResults as Array<[string, Trip | null]>) {
    if (!trip || seenTrips.has(trip.tripId)) continue;
    seenTrips.add(trip.tripId);
    const ordered = [...trip.times].sort((a, b) => a.index - b.index);
    if (ordered.length === 0) continue;

    const routeId = "L_" + (trip.lineName || "X");
    const existing = routes.get(routeId);
    if (!existing) {
      routes.set(routeId, {
        route_id: routeId,
        agency_id: config.AGENCY_ID,
        route_short_name: trip.lineName || "",
        route_long_name: trip.direction || "",
        route_type: config.routeTypeFor(trip.lineType, trip.vehicleType),
        route_url: "",
      });
    } else if (trip.direction && !existing.route_long_name) {
      existing.route_long_name = trip.direction;
    }

    const shapeId = `shp_${trip.tripId}`;
    ordered.forEach((ts, seq) => {
      const st = ts.designator ? stopById.get(ts.designator) : undefined;
      const stopId = ts.designator ? String(ts.designator) : ts.placeId || "";
      stopTimesRows.push({
        trip_id: trip.tripId,
        arrival_time: fmtTime(ts.departureTime),
        departure_time: fmtTime(ts.departureTime),
        stop_id: stopId,
        stop_sequence: seq,
        pickup_type: "",
        drop_off_type: "",
        shape_dist_traveled: "",
      });
      if (st) {
        shapesRows.push({
          shape_id: shapeId,
          shape_pt_lat: st.lat.toFixed(6),
          shape_pt_lon: st.lon.toFixed(6),
          shape_pt_sequence: seq,
        });
      } else if (ts.designator == null && ts.placeId) {
        const ps = stopByUrl.get(ts.placeId);
        if (ps) {
          shapesRows.push({
            shape_id: shapeId,
            shape_pt_lat: ps.lat.toFixed(6),
            shape_pt_lon: ps.lon.toFixed(6),
            shape_pt_sequence: seq,
          });
        }
      }
    });

    tripsRows.push({
      route_id: routeId,
      service_id: "KB_" + date.replace(/-/g, ""),
      trip_id: trip.tripId,
      trip_headsign: compact(trip.direction),
      trip_short_name: trip.showName ? trip.lineName : "",
      direction_id: "",
      shape_id: shapeId,
    });
  }

  writeGtfs(outDir, stops, routes, tripsRows, stopTimesRows, shapesRows, date);
  console.log(`[gtfs] wrote files to ${outDir}`);
  console.log(`[gtfs] trips=${tripsRows.length} routes=${routes.size} stop_times=${stopTimesRows.length} shapes=${shapesRows.length}`);

  if (doZip) {
    const zp = path.join(outDir, "kb_gtfs.zip");
    const files: Record<string, Uint8Array> = {};
    for (const name of fs.readdirSync(outDir)) {
      if (name.endsWith(".txt")) files[name] = new Uint8Array(fs.readFileSync(path.join(outDir, name)));
    }
    fs.writeFileSync(zp, zipSync(files, { level: 6 }));
    console.log(`[gtfs] wrote ${zp}`);
  }
}

function main(): void {
  const { values } = parseArgs({
    options: {
      date: { type: "string", default: config.todayLocalISO() },
      out: { type: "string", default: config.GTFS_DIR },
      concurrency: { type: "string", default: String(config.DEFAULT_CONCURRENCY) },
      zip: { type: "boolean", default: true },
      "no-zip": { type: "boolean", default: false },
    },
  });
  const doZip = values["no-zip"] ? false : Boolean(values.zip);
  const concurrencyNum = Number(values.concurrency);
  const concurrency = Number.isFinite(concurrencyNum) && concurrencyNum > 0
    ? Math.trunc(concurrencyNum)
    : config.DEFAULT_CONCURRENCY;

  build(values.date as string, values.out as string, concurrency, doZip).catch((err: unknown) => {
    console.error(`[gtfs] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
}

main();
