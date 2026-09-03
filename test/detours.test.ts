import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adjustStopRoutePoint, getLineDetour, injectDetourPoints } from "../lib/client/detours";
import type { LatLng } from "../lib/client/types";

describe("getLineDetour", () => {
  it("matches line 121 and 134 to Piastowska detour", () => {
    const d121 = getLineDetour("121");
    assert.ok(d121);
    assert.equal(d121?.id, "bielsko-piastowska");

    const d134 = getLineDetour("134");
    assert.ok(d134);
    assert.equal(d134?.id, "bielsko-piastowska");
  });

  it("matches line 141 to Osiek detour", () => {
    const d = getLineDetour("141");
    assert.ok(d);
    assert.equal(d?.id, "osiek-beskidzka");
  });

  it("returns null for unaffected lines", () => {
    assert.equal(getLineDetour("999"), null);
    assert.equal(getLineDetour(""), null);
  });
});

describe("injectDetourPoints", () => {
  it("injects detour waypoints when points pass through affected area", () => {
    // Points starting at Bielsko DA, passing near Piastowska, heading to Hulanka
    const pts: LatLng[] = [
      [49.827, 19.049], // DA
      [49.823, 19.040], // near Piastowska inside box
      [49.818, 19.025], // past Hulanka
    ];
    const res = injectDetourPoints(pts, "121", "Hulanka");
    assert.ok(res.detour);
    assert.ok(res.points.length > pts.length);
    // Contains Słowackiego / Grunwaldzka / Konopnickiej waypoints
    assert.ok(res.points.some((p) => Math.abs(p[0] - 49.8241) < 1e-4));
  });

  it("leaves points unchanged if line has no detour", () => {
    const pts: LatLng[] = [
      [49.827, 19.049],
      [49.818, 19.025],
    ];
    const res = injectDetourPoints(pts, "999");
    assert.equal(res.detour, null);
    assert.equal(res.points.length, pts.length);
  });
});

describe("adjustStopRoutePoint", () => {
  it("adjusts Szczyrk Wodospad 21181 onto DW942 center", () => {
    const original: LatLng = [49.702919, 19.001412];
    const adjusted = adjustStopRoutePoint("21181", original);
    assert.deepEqual(adjusted, [49.70298, 19.00137]);
  });

  it("passes unmapped stops through unmodified", () => {
    const original: LatLng = [49.8, 19.0];
    const adjusted = adjustStopRoutePoint("99999", original);
    assert.deepEqual(adjusted, original);
  });
});
