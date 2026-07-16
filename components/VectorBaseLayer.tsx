"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-leaflet";

/**
 * Renders an OpenFreeMap vector style (MapLibre GL) as the Leaflet base layer —
 * the same free, keyless, crisp basemap zbiorkom.live uses. The GL canvas draws
 * into Leaflet's `tilePane` (z-index 200), so vehicle/stop markers and trip
 * routes stay on top untouched.
 */
export type BasemapStatus = "loading" | "ready" | "failed";

/** the slice of maplibregl.Map we touch — keeps maplibre types out of the bundle */
type GlMap = {
  once(type: "idle", fn: () => void): unknown;
  on(type: "error", fn: () => void): unknown;
  off(type: "idle" | "error", fn: () => void): unknown;
  isStyleLoaded(): boolean;
  areTilesLoaded(): boolean;
  resize(): unknown;
};
type MaplibreGLLayer = L.Layer & {
  getContainer: () => HTMLDivElement;
  getMaplibreMap: () => GlMap;
};
type MaplibreGLFactory = (opts: {
  style: string;
  attribution?: string;
  /** bridge option: render this fraction of the viewport beyond each edge so
   *  panning reveals already-drawn map instead of blank tiles */
  padding?: number;
  /** maplibre Map options — forwarded verbatim into `new maplibregl.Map()` */
  fadeDuration?: number;
  maxTileCacheSize?: number;
  refreshExpiredTiles?: boolean;
}) => MaplibreGLLayer;

const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ' +
  'Data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap</a>';

/** style JSON never arrived after this long → give up and let the caller fall back */
const STYLE_TIMEOUT_MS = 12_000;

export default function VectorBaseLayer({
  style,
  filter,
  onStatus,
}: {
  style: string;
  /** CSS filter applied to the basemap canvas only (e.g. "brightness(.8)") */
  filter?: string;
  /** basemap readiness for the caller's loading veil / raster fallback;
   *  must be useCallback-stable — it is an effect dependency */
  onStatus?: (s: BasemapStatus) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const maplibreGL = (L as unknown as { maplibreGL: MaplibreGLFactory }).maplibreGL;
    const layer = maplibreGL({
      style,
      attribution: OFM_ATTRIBUTION,
      // ---- smoothness tuning (targets the "blank/late/pixelated tiles" jank) ----
      // render 18% beyond the viewport so a pan shows drawn map, not blank
      padding: 0.18,
      // no cross-fade: freshly loaded tiles snap in instead of ghosting for 300ms
      fadeDuration: 0,
      // keep lots of already-rendered tiles so zoom-out/in & back-pan are instant
      maxTileCacheSize: 1024,
      // don't re-download still-valid tiles mid-session
      refreshExpiredTiles: false,
    }) as MaplibreGLLayer;
    layer.addTo(map);
    // filter the GL container, not the markers/routes in the other panes
    const container = layer.getContainer();
    container.style.filter = filter ?? "";

    /* readiness: `idle` with style + tiles actually loaded = painted map.
       A bare `idle` can fire before any tile was even requested (canvas sized
       from a not-yet-settled container), which would drop the caller's veil
       onto a bare style-background flash — so re-arm until tiles confirm.
       `error` also fires for transient tile fetches, so only a style that
       never loaded (or the timeout hitting first) counts as failure. */
    onStatus?.("loading");
    const gl = layer.getMaplibreMap(); // _glMap exists synchronously after addTo
    let settled = false;
    const settle = (s: BasemapStatus) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      onStatus?.(s);
    };
    const onIdle = () => {
      if (settled) return;
      if (gl.isStyleLoaded() && gl.areTilesLoaded()) settle("ready");
      else gl.once("idle", onIdle); // idle fired too early — wait for the next one
    };
    const onErr = () => {
      if (!gl.isStyleLoaded()) settle("failed");
    };
    const timer = window.setTimeout(
      () => settle(gl.isStyleLoaded() ? "ready" : "failed"),
      STYLE_TIMEOUT_MS,
    );
    gl.once("idle", onIdle);
    gl.on("error", onErr);
    /* re-measure once layout settles (dvh on mobile) — a canvas created from a
       stale container size renders a mis-sized patch until something resizes */
    const raf = requestAnimationFrame(() => {
      if (!settled) gl.resize();
    });

    return () => {
      // unhook GL listeners before removeLayer — onRemove nulls the GL map
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      gl.off("idle", onIdle);
      gl.off("error", onErr);
      map.removeLayer(layer);
    };
  }, [map, style, filter, onStatus]);

  return null;
}
