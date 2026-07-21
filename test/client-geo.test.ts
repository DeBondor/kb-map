import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDistance, haversineMeters, nearestStops } from "../lib/client/geo";
import type { Stop } from "../lib/client/types";

describe("haversineMeters", () => {
  it("1° of latitude ≈ 111.2 km", () => {
    const d = haversineMeters(0, 0, 1, 0);
    assert.ok(Math.abs(d - 111195) < 100, `got ${d}`);
  });

  it("zero for identical points", () => {
    assert.equal(haversineMeters(49.8, 19.0, 49.8, 19.0), 0);
  });
});

describe("formatDistance", () => {
  it("rounds metres to tens below 1 km, Polish comma above", () => {
    assert.equal(formatDistance(234), "230 m");
    assert.equal(formatDistance(0), "0 m");
    assert.equal(formatDistance(1000), "1,0 km");
    assert.equal(formatDistance(1400), "1,4 km");
  });
});

describe("nearestStops", () => {
  const stop = (id: string, lat: number, lon: number): Stop => ({
    id,
    designator: id,
    name: id,
    lat,
    lon,
  });

  it("orders nearest first and applies the limit", () => {
    const stops = [stop("far", 50.0, 19.0), stop("near", 49.81, 19.0), stop("mid", 49.9, 19.0)];
    const res = nearestStops(stops, { lat: 49.8, lon: 19.0 }, 2);
    assert.deepEqual(
      res.map((r) => r.s.id),
      ["near", "mid"],
    );
    assert.ok(res[0].dist < res[1].dist);
  });
});
