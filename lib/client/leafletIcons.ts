/**
 * Leaflet divIcon factories: the zbiorkom-style vehicle pill (rotating heading
 * arrow + the KB brand bus mark + line number, all on the line/status color)
 * and the pulsing selected-stop marker.
 * CLIENT-ONLY: imports leaflet, must only be reached from ssr:false trees.
 */
import L from "leaflet";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Navigation arrow, points up (north) at 0°; CSS rotate matches compass bearing. */
const ARROW_PATH = "M12 5 18 19 12 16 6 19Z";

export function makeVehicleIcon(line: string, color: string, bearing: number | null): L.DivIcon {
  const hasHeading = bearing != null;
  const arrow = hasHeading
    ? `<span class="veh-arrow" style="transform:rotate(${bearing}deg)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ARROW_PATH}"/></svg></span>`
    : "";
  return L.divIcon({
    className: "veh-marker",
    html:
      `<div class="veh-wrap"><div class="veh-pill${hasHeading ? "" : " no-heading"}" style="background:${color}">` +
      arrow +
      `<img class="veh-bus" src="/brand.svg" alt="" aria-hidden="true" draggable="false"/>` +
      `<span class="veh-line">${escapeHtml(line || "?")}</span></div></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

/** Bus glyph (boxy body, window band, two wheels) — matches the search results. */
const BUS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4.5" width="18" height="11" rx="2.5"/>' +
  '<path d="M3 10.5h18M8 4.5v6M12 4.5v6M16 4.5v6"/>' +
  '<circle cx="7.5" cy="16.6" r="1.4" fill="currentColor" stroke="none"/>' +
  '<circle cx="16.5" cy="16.6" r="1.4" fill="currentColor" stroke="none"/></svg>';

/**
 * A bus-stop marker for the higher-zoom map: a small bus sign plus one arrow per
 * GTFS-derived travel direction (`dirs`, compass degrees). Each arrow sits on
 * the sign's rim pointing the way buses leave — two arrows for a both-ways stop.
 */
export function makeStopIcon(dirs: number[] = []): L.DivIcon {
  const arrows = dirs
    .map(
      (d) =>
        `<span class="stop-dir" style="transform:rotate(${d}deg)"><span class="stop-dir-a"></span></span>`,
    )
    .join("");
  return L.divIcon({
    className: "stop-mk-icon",
    html: `<div class="stop-mk">${arrows}<span class="stop-mk-sign">${BUS_SVG}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export function makeStopPingIcon(): L.DivIcon {
  return L.divIcon({
    className: "stop-ping-marker",
    html: '<div class="stop-ping"><span class="ring"></span><span class="core"></span></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

/** "You are here" dot — a pulsing blue GPS marker, distinct from brand red. */
export function makeUserLocationIcon(): L.DivIcon {
  return L.divIcon({
    className: "user-loc-marker",
    html: '<span class="user-loc"><span class="user-loc-pulse"></span><span class="user-loc-dot"></span></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}
