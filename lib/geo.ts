/**
 * Server-side geometry helpers shared by the poller and the GTFS-derived
 * stop-direction computation. (The client has its own haversine in
 * lib/client/geo.ts — that file is "use client" and must not be imported here.)
 */

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
