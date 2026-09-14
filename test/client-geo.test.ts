import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findActiveStop, formatDistance, haversineMeters, nearestStops } from "../lib/client/geo";
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

describe("findActiveStop", () => {
  const stops = [
    { lat: 49.710, lon: 19.010 }, // Stop 0
    { lat: 49.700, lon: 18.996 }, // Stop 1 (Widokowa)
    { lat: 49.696, lon: 18.990 }, // Stop 2 (Gondola)
    { lat: 49.690, lon: 18.980 }, // Stop 3 (Salmopol)
  ];

  it("identifies when vehicle is physically at stop 1", () => {
    // Within 20m of Stop 1
    const res = findActiveStop(stops, { lat: 49.7001, lon: 18.9961, at_stop: true });
    assert.equal(res.index, 1);
    assert.equal(res.isAtStop, true);
    assert.equal(res.progress, 1);
  });

  it("marks stop 1 as passed and targets stop 2 when vehicle has departed past stop 1", () => {
    // Vehicle is 300m past Stop 1, driving along segment 1 -> 2
    const res = findActiveStop(stops, { lat: 49.698, lon: 18.993, at_stop: false });
    assert.equal(res.index, 2);
    assert.equal(res.isAtStop, false);
    assert.ok(res.progress != null && res.progress > 0 && res.progress < 1);
  });

  it("respects upstream at_stop = false to advance past departed stop", () => {
    const res = findActiveStop(stops, {
      lat: 49.699,
      lon: 18.994,
      at_stop: false,
      current_stop_sequence: 1,
    });
    assert.equal(res.index, 2);
    assert.equal(res.isAtStop, false);
    assert.ok(res.progress != null && res.progress > 0 && res.progress < 1);
  });
});
