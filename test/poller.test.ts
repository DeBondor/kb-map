/**
 * Pins for the pure schedule/geometry helpers in lib/poller.ts. Importing the
 * module is safe (no network at import time); tests must never construct
 * LivePoller/KbApi or touch lib/poller-singleton.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bearing, metersBetween } from "../lib/geo";
import { hhmmToSecs, nowSecs, vehicleToJson } from "../lib/poller";
import { haversineMeters } from "../lib/client/geo";
import type { VehiclePos } from "../lib/types";

describe("hhmmToSecs", () => {
  it("parses HH:MM, ignoring a seconds part", () => {
    assert.equal(hhmmToSecs("5:30"), 19800);
    assert.equal(hhmmToSecs("05:30:45"), 19800);
    assert.equal(hhmmToSecs("7:5"), 25500);
  });

  it("returns null for anything unparsable", () => {
    assert.equal(hhmmToSecs(""), null);
    assert.equal(hhmmToSecs("abc"), null);
    assert.equal(hhmmToSecs("12"), null);
    assert.equal(hhmmToSecs("10:xx"), null);
    assert.equal(hhmmToSecs(null), null);
    assert.equal(hhmmToSecs(1230), null);
  });
});

describe("metersBetween (planar approximation)", () => {
  it("agrees with haversine within a few % at city scale", () => {
    // Bielsko-Biała centre -> Szczyrk, ~15 km
    const planar = metersBetween(49.8225, 19.0444, 49.7167, 19.0333);
    const exact = haversineMeters(49.8225, 19.0444, 49.7167, 19.0333);
    assert.ok(Math.abs(planar - exact) / exact < 0.03, `planar=${planar} exact=${exact}`);
  });

  it("~15 m at the ghost-filter epsilon scale", () => {
    const d = metersBetween(49.8225, 19.0444, 49.822635, 19.0444);
    assert.ok(Math.abs(d - 15) < 0.1, `got ${d}`);
  });
});

describe("bearing", () => {
  it("cardinal directions", () => {
    assert.equal(bearing(0, 0, 1, 0), 0); // north
    assert.equal(bearing(0, 0, 0, 1), 90); // east
    assert.equal(bearing(1, 0, 0, 0), 180); // south
    assert.equal(bearing(0, 1, 0, 0), 270); // west
  });

  it("null for identical points, always in [0, 360)", () => {
    assert.equal(bearing(49.8, 19.0, 49.8, 19.0), null);
    const b = bearing(49.8, 19.0, 49.9, 18.9);
    assert.ok(b !== null && b >= 0 && b < 360);
  });
});

describe("vehicleToJson", () => {
  const pos: VehiclePos = {
    execId: "19132:39688",
    tripId: "T1",
    routeId: "L_120",
    line: "120",
    headsign: "SZCZYRK",
    lat: 49.1234567,
    lon: 19.7654321,
    vehicleType: 1,
    currentStopSequence: 4,
    atStop: false,
    delay: -30,
    timestamp: 1700000000,
    updatedAt: 1700000000.123,
    bearing: 123.456,
    nextStopName: "TESTOWA",
    nextStopLat: null,
    nextStopLon: 19.87654321,
    lastMovedAt: 0,
    anchorLat: 0,
    anchorLon: 0,
    finished: false,
  };

  it("rounds coords to 6 dp, bearing to 1 dp, updated_at to 1 dp; nulls pass through", () => {
    const j = vehicleToJson(pos);
    assert.equal(j.id, "19132:39688");
    assert.equal(j.lat, 49.123457);
    assert.equal(j.lon, 19.765432);
    assert.equal(j.bearing, 123.5);
    assert.equal(j.updated_at, 1700000000.1);
    assert.equal(j.next_stop_lat, null);
    assert.equal(j.next_stop_lon, 19.876543);
    assert.equal(j.delay, -30);
    assert.equal(j.current_stop_sequence, 4);
    const nulled = vehicleToJson({ ...pos, bearing: null, delay: null, currentStopSequence: null });
    assert.equal(nulled.bearing, null);
    assert.equal(nulled.delay, null);
    assert.equal(nulled.current_stop_sequence, null);
  });
});

describe("nowSecs (agency-local clock)", () => {
  it("is an integer in [0, 86400)", () => {
    const s = nowSecs();
    assert.ok(Number.isInteger(s));
    assert.ok(s >= 0 && s < 86400);
  });

  it("matches an independently computed Europe/Warsaw wall clock (±2 s)", () => {
    // en-US locale + a different assembly path than the implementation's en-GB
    const txt = new Date().toLocaleTimeString("en-US", {
      timeZone: "Europe/Warsaw",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const [h, m, sec] = txt.split(":").map(Number);
    const expected = (h % 24) * 3600 + m * 60 + sec;
    const got = nowSecs();
    const diff = Math.abs(got - expected);
    // tolerate the seconds boundary between the two reads, and midnight wrap
    assert.ok(diff <= 2 || diff >= 86398, `got=${got} expected=${expected}`);
  });
});
