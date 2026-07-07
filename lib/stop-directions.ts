/**
 * Per-stop travel direction(s), derived offline from the built GTFS feed.
 *
 * For every trip we walk consecutive stops (A → B) and credit stop A with the
 * compass bearing toward B — "the way buses leave A". A stop is usually served
 * in two opposite ways (peron 1 / peron 2), so the collected bearings are
 * clustered and the 1–2 dominant directions are kept. The result is merged into
 * GET /api/stops so the map can draw a bus-stop icon pointing the right way.
 *
 * Reads the already-built `output/gtfs/{stops,stop_times}.txt`; if the feed is
 * absent the map simply shows no arrows (graceful, never throws).
 */
import fs from "node:fs";
import path from "node:path";

import * as config from "./config";

/** Initial great-circle bearing p1→p2 in degrees [0,360), or null if identical. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number | null {
  if (lat1 === lat2 && lon1 === lon2) return null;
  const rad = Math.PI / 180;
  const phi1 = lat1 * rad;
  const phi2 = lat2 * rad;
  const dlon = (lon2 - lon1) * rad;
  const x = Math.sin(dlon) * Math.cos(phi2);
  const y = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlon);
  return ((Math.atan2(x, y) / rad) + 360) % 360;
}

/** Smallest absolute angle between two compass bearings, degrees [0,180]. */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Minimal RFC-4180 line parser (handles quoted fields with embedded commas). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Column index by header name, or -1. */
function col(header: string[], name: string): number {
  return header.indexOf(name);
}

/** Split on CR, LF or CRLF so a trailing '\r' never sticks to the last column
 *  (the built GTFS files are CRLF). */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * Greedily cluster bearings (circular, within THRESHOLD) and return the up-to-2
 * dominant directions, ordered by support. A weak second cluster (one that only
 * a couple of trips back) is dropped so a stray routing doesn't add a false arrow.
 */
function dominantDirections(bearings: number[]): number[] {
  const THRESHOLD = 35;
  const clusters: Array<{ sin: number; cos: number; n: number }> = [];
  for (const b of bearings) {
    const r = (b * Math.PI) / 180;
    let best = -1;
    let bestDiff = THRESHOLD;
    for (let i = 0; i < clusters.length; i++) {
      const mean = ((Math.atan2(clusters[i].sin, clusters[i].cos) * 180) / Math.PI + 360) % 360;
      const d = angleDiff(b, mean);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    if (best >= 0) {
      clusters[best].sin += Math.sin(r);
      clusters[best].cos += Math.cos(r);
      clusters[best].n += 1;
    } else {
      clusters.push({ sin: Math.sin(r), cos: Math.cos(r), n: 1 });
    }
  }
  clusters.sort((a, b) => b.n - a.n);
  const kept = clusters
    .slice(0, 2)
    .filter((c, i) => i === 0 || (c.n >= 2 && c.n >= clusters[0].n * 0.2));
  return kept.map((c) => Math.round(((Math.atan2(c.sin, c.cos) * 180) / Math.PI + 360) % 360));
}

let cache: Map<string, number[]> | null = null;

function compute(): Map<string, number[]> {
  const dir = config.GTFS_DIR;
  const result = new Map<string, number[]>();
  let stopsTxt: string;
  let timesTxt: string;
  try {
    stopsTxt = fs.readFileSync(path.join(dir, "stops.txt"), "utf-8");
    timesTxt = fs.readFileSync(path.join(dir, "stop_times.txt"), "utf-8");
  } catch {
    return result; // no feed → no arrows
  }

  // stop_id → [lat, lon]
  const coords = new Map<string, [number, number]>();
  {
    const lines = splitLines(stopsTxt);
    const header = parseCsvLine(lines[0]);
    const iId = col(header, "stop_id");
    const iLat = col(header, "stop_lat");
    const iLon = col(header, "stop_lon");
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const f = parseCsvLine(lines[i]);
      // guard empty cells: Number("") is 0, which would place a phantom (0,0) stop
      if (!f[iId] || f[iLat] === "" || f[iLon] === "") continue;
      const lat = Number(f[iLat]);
      const lon = Number(f[iLon]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) coords.set(f[iId], [lat, lon]);
    }
  }

  // trip_id → [ (seq, stop_id) ] in file order, then sorted by seq per trip
  const lines = splitLines(timesTxt);
  const header = parseCsvLine(lines[0]);
  const iTrip = col(header, "trip_id");
  const iStop = col(header, "stop_id");
  const iSeq = col(header, "stop_sequence");
  const perTrip = new Map<string, Array<[number, string]>>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = parseCsvLine(lines[i]);
    const trip = f[iTrip];
    const stopId = f[iStop];
    const rawSeq = f[iSeq];
    const seq = Number(rawSeq);
    // skip empty seq cells (Number("") === 0 would fabricate a stop_sequence 0)
    if (!trip || !stopId || !rawSeq || !Number.isFinite(seq)) continue;
    let arr = perTrip.get(trip);
    if (!arr) { arr = []; perTrip.set(trip, arr); }
    arr.push([seq, stopId]);
  }

  // accumulate outgoing bearings per stop
  const acc = new Map<string, number[]>();
  for (const arr of perTrip.values()) {
    arr.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < arr.length - 1; i++) {
      const a = coords.get(arr[i][1]);
      const b = coords.get(arr[i + 1][1]);
      if (!a || !b) continue;
      const brg = bearing(a[0], a[1], b[0], b[1]);
      if (brg === null) continue;
      let list = acc.get(arr[i][1]);
      if (!list) { list = []; acc.set(arr[i][1], list); }
      list.push(brg);
    }
  }

  for (const [stopId, bearings] of acc) {
    const dirs = dominantDirections(bearings);
    if (dirs.length) result.set(stopId, dirs);
  }
  return result;
}

/** Lazily computed, process-lifetime cache of stop_id → up to two bearings. */
export function getStopDirections(): Map<string, number[]> {
  if (!cache) cache = compute();
  return cache;
}
