import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import manifestFn from "../app/manifest";
import { KbApi } from "../lib/kb-api";

describe("Site Performance & Optimization Invariants", () => {
  describe("PWA Fullscreen & Safe-Area Configuration", () => {
    it("includes apple-touch-fullscreen and fullscreen manifest display override", () => {
      const layoutSrc = fs.readFileSync(path.resolve(process.cwd(), "app/layout.tsx"), "utf-8");
      assert.ok(
        layoutSrc.includes('"apple-touch-fullscreen": "yes"'),
        "layout must include apple-touch-fullscreen for iOS PWA fullscreen",
      );

      const manifest = manifestFn();
      assert.ok(
        manifest.display_override?.includes("fullscreen"),
        "manifest display_override must include fullscreen",
      );
      assert.equal(manifest.display, "standalone", "manifest display must remain standalone for fallback");
    });

    it("ensures TopBar uses safe-area offset with 0.75rem clearance to clear iOS status blur", () => {
      const topBarSrc = fs.readFileSync(path.resolve(process.cwd(), "components/TopBar.tsx"), "utf-8");
      assert.ok(
        topBarSrc.includes("calc(env(safe-area-inset-top,0px)+0.75rem)"),
        "TopBar must include clearance below safe-area to prevent entering topbar blur",
      );

      const filterSrc = fs.readFileSync(path.resolve(process.cwd(), "components/LineFilterChip.tsx"), "utf-8");
      assert.ok(
        filterSrc.includes("calc(env(safe-area-inset-top,0px)+0.75rem+56px)"),
        "LineFilterChip must stay aligned with TopBar",
      );

      const toastSrc = fs.readFileSync(path.resolve(process.cwd(), "components/Toast.tsx"), "utf-8");
      assert.ok(
        toastSrc.includes("calc(env(safe-area-inset-top,0px)+0.75rem+60px)"),
        "Toast must stay aligned with TopBar",
      );
    });

    it("verifies preconnect links to tile CDNs in layout.tsx", () => {
      const layoutSrc = fs.readFileSync(path.resolve(process.cwd(), "app/layout.tsx"), "utf-8");
      assert.ok(layoutSrc.includes('rel="preconnect" href="https://tiles.openfreemap.org"'));
      assert.ok(layoutSrc.includes('rel="dns-prefetch" href="https://tiles.openfreemap.org"'));
      assert.ok(layoutSrc.includes('rel="preconnect" href="https://tile.openstreetmap.org"'));
    });
  });

  describe("API Client & In-Memory Caching", () => {
    it("KbApi instance provides fetchTripsBatch method", () => {
      const api = new KbApi();
      assert.equal(typeof api.fetchTripsBatch, "function");
      assert.equal(typeof api.fetchTripRaw, "function");
      assert.equal(typeof api.fetchTimetable, "function");
    });

    it("client api exposes getTripsBatch", async () => {
      const clientApi = await import("../lib/client/api");
      assert.equal(typeof clientApi.getTripsBatch, "function");
      assert.equal(typeof clientApi.getTrip, "function");
    });
  });

  describe("Map Readiness Tuning", () => {
    it("VectorBaseLayer uses reduced tile padding and faster timeout fallback", () => {
      const baseLayerSrc = fs.readFileSync(path.resolve(process.cwd(), "components/VectorBaseLayer.tsx"), "utf-8");
      assert.ok(baseLayerSrc.includes("padding: 0.08"), "tile padding must be optimized for cold load");
      assert.ok(baseLayerSrc.includes("STYLE_TIMEOUT_MS = 5_000"), "style timeout must be 5s for fast fallback");
      assert.ok(!baseLayerSrc.includes("gl.areTilesLoaded()"), "should not block screen veil waiting for 100% tiles");
    });
  });
});
