"use client";

/** Distance helpers for the command palette's "nearest stops" features. */
import type { Stop } from "@/lib/client/types";

/** Great-circle distance in meters (haversine). */
export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** "230 m" below 1 km, then "1,4 km" (Polish decimal comma). */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

/** The `limit` stops closest to `pos`, nearest first. O(n) over ~956 stops. */
export function nearestStops(
  stops: Stop[],
  pos: { lat: number; lon: number },
  limit: number,
): Array<{ s: Stop; dist: number }> {
  return stops
    .map((s) => ({ s, dist: haversineMeters(pos.lat, pos.lon, s.lat, s.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

export interface ActiveStopResult {
  /** The stop index the vehicle is currently at or approaching next */
  index: number;
  /** True if the vehicle is currently stopped at the stop, false if in transit towards it */
  isAtStop: boolean;
}

/**
 * Determines the active stop index along a route given vehicle GPS position.
 * Stops with index < result.index are PASSED.
 * If isAtStop is true, the bus is at stop `result.index`.
 * If isAtStop is false, the bus has departed from the previous stop and is moving towards `result.index`.
 */
export function findActiveStop(
  stops: Array<{ lat: number; lon: number }>,
  vehicle: { lat: number; lon: number; at_stop?: boolean; current_stop_sequence?: number | null } | null,
  vtiHint?: number | null,
): ActiveStopResult {
  const n = stops.length;
  if (n === 0) return { index: 0, isAtStop: false };
  if (n === 1) return { index: 0, isAtStop: true };

  // If no valid vehicle coords, use vtiHint
  if (!vehicle || !Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) {
    const hint = vtiHint ?? 0;
    return { index: Math.max(0, Math.min(n - 1, hint)), isAtStop: false };
  }

  const vLat = vehicle.lat;
  const vLon = vehicle.lon;

  // 1. Check if the vehicle is physically at any stop (within 55m)
  let closestStopIdx = 0;
  let minStopDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = haversineMeters(vLat, vLon, stops[i].lat, stops[i].lon);
    if (d < minStopDist) {
      minStopDist = d;
      closestStopIdx = i;
    }
  }

  // If vehicle is physically at the stop (<= 55m)
  if (minStopDist <= 55) {
    if (vehicle.at_stop !== false) {
      return { index: closestStopIdx, isAtStop: true };
    }
  }

  // 2. If upstream explicitly provided at_stop === false and current_stop_sequence:
  // In upstream dispatch, current_stop_sequence is the stop the vehicle has already left!
  if (vehicle.at_stop === false && vehicle.current_stop_sequence != null) {
    const seq = vehicle.current_stop_sequence;
    if (seq >= 0 && seq < n - 1) {
      return { index: seq + 1, isAtStop: false };
    }
    if (seq >= n - 1) {
      return { index: n - 1, isAtStop: true };
    }
  }

  // 3. Geometric segment projection onto the route:
  // Find which consecutive segment S_i -> S_{i+1} the vehicle is currently driving on.
  const anchor = vtiHint != null && vtiHint >= 0 && vtiHint < n ? vtiHint : closestStopIdx;
  const startI = Math.max(0, anchor - 3);
  const endI = Math.min(n - 2, anchor + 3);

  let bestSegIdx = 0;
  let minSegDist = Infinity;

  for (let i = startI; i <= endI; i++) {
    const A = stops[i];
    const B = stops[i + 1];

    const rad = Math.PI / 180;
    const cosLat = Math.cos(A.lat * rad);
    const dx = (B.lon - A.lon) * cosLat;
    const dy = B.lat - A.lat;
    const L2 = dx * dx + dy * dy;

    if (L2 < 1e-12) continue;

    const vx = (vLon - A.lon) * cosLat;
    const vy = vLat - A.lat;
    const t = (vx * dx + vy * dy) / L2;

    const clampedT = Math.max(0, Math.min(1, t));
    const projLat = A.lat + clampedT * dy;
    const projLon = A.lon + (clampedT * dx) / cosLat;
    const distToSeg = haversineMeters(vLat, vLon, projLat, projLon);

    if (distToSeg < minSegDist) {
      minSegDist = distToSeg;
      bestSegIdx = i;
    }
  }

  // The vehicle is driving on segment bestSegIdx -> bestSegIdx + 1.
  // Stop bestSegIdx has been passed, and the vehicle is approaching bestSegIdx + 1!
  return { index: bestSegIdx + 1, isAtStop: false };
}
