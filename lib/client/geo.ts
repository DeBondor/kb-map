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
