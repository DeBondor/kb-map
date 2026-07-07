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
type MaplibreGLLayer = L.Layer & { getContainer: () => HTMLDivElement };
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

export default function VectorBaseLayer({
  style,
  filter,
}: {
  style: string;
  /** CSS filter applied to the basemap canvas only (e.g. "brightness(.8)") */
  filter?: string;
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
    });
    layer.addTo(map);
    // filter the GL container, not the markers/routes in the other panes
    const container = layer.getContainer();
    container.style.filter = filter ?? "";
    return () => {
      map.removeLayer(layer);
    };
  }, [map, style, filter]);

  return null;
}
