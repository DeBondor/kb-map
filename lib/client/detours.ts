import type { LatLng } from "./types";

export interface LineDetour {
  id: string;
  lines: string[];
  title: string;
  description: string;
  /** direction substring filter if direction-specific (e.g. "HULANKA", "JAWORZE", "SZCZYRK") */
  directionContains?: string;
  /** Bounding box or trigger area where detour applies [minLat, minLon, maxLat, maxLon] */
  triggerArea?: [number, number, number, number];
  /** Waypoints to route through instead of the standard road */
  viaWaypoints: LatLng[];
}

/**
 * Known prolonged detours (objazdy długoterminowe) in Komunikacja Beskidzka network.
 * Derived from active roadworks and carrier announcements.
 */
export const KNOWN_DETOURS: LineDetour[] = [
  {
    id: "bielsko-piastowska",
    // Remont ul. Piastowskiej od 18.08.2025 do odwołania w kierunku Hulanki
    lines: ["121", "122", "123", "124", "125", "127", "129", "131", "132", "133", "134"],
    title: "Objazd: remont ul. Piastowskiej",
    description: "Trasa poprowadzona ulicami Słowackiego, Grunwaldzką i Konopnickiej.",
    triggerArea: [49.815, 19.030, 49.835, 19.055],
    viaWaypoints: [
      [49.8241, 19.0412], // ul. Słowackiego (BCK)
      [49.8218, 19.0365], // ul. Grunwaldzka (Szpital Miejski)
      [49.8205, 19.0315], // ul. Konopnickiej (Szpital Pediatryczny)
    ],
  },
  {
    id: "osiek-beskidzka",
    // Zamknięcie ul. Beskidzkiej w Osieku - objazd ul. Zieloną
    lines: ["141", "143"],
    title: "Objazd w Osieku",
    description: "Objazd ul. Beskidzkiej realizowany ulicą Zieloną.",
    triggerArea: [49.930, 19.240, 49.970, 19.290],
    viaWaypoints: [
      [49.9455, 19.2612], // ul. Zielona
      [49.9498, 19.2685],
    ],
  },
  {
    id: "jasienica-strumienska",
    // Zamknięcie odcinka ul. Strumieńskiej w Jasienicy
    lines: ["123", "125", "129", "131", "132"],
    title: "Objazd w Jasienicy",
    description: "Tymczasowa trasa w rejonie ul. Młyńskiej.",
    triggerArea: [49.810, 18.890, 49.835, 18.930],
    viaWaypoints: [
      [49.8215, 18.9080], // ul. Młyńska
    ],
  },
];

/**
 * Checks if a line has an active detour definition.
 */
export function getLineDetour(line: string, direction?: string): LineDetour | null {
  if (!line) return null;
  const cleanLine = line.trim();
  const detour = KNOWN_DETOURS.find((d) => {
    if (!d.lines.includes(cleanLine)) return false;
    if (d.directionContains && direction) {
      if (!direction.toUpperCase().includes(d.directionContains.toUpperCase())) return false;
    }
    return true;
  });
  return detour ?? null;
}

/**
 * Injects detour waypoints into the sequence of stop coordinates if the route passes through
 * the affected detour area.
 */
export function injectDetourPoints(
  points: LatLng[],
  line?: string,
  direction?: string,
): { points: LatLng[]; detour: LineDetour | null } {
  if (!line || points.length < 2) return { points, detour: null };
  const detour = getLineDetour(line, direction);
  if (!detour) return { points, detour: null };

  const area = detour.triggerArea;
  if (!area) {
    return { points, detour };
  }

  const [minLat, minLon, maxLat, maxLon] = area;
  let firstInside = -1;
  let lastInside = -1;

  for (let i = 0; i < points.length; i++) {
    const [lat, lon] = points[i];
    if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) {
      if (firstInside === -1) firstInside = i;
      lastInside = i;
    }
  }

  if (firstInside === -1) {
    return { points, detour: null };
  }

  // Insert detour via points between firstInside and lastInside
  const before = points.slice(0, firstInside + 1);
  const after = points.slice(lastInside);
  const combined = [...before, ...detour.viaWaypoints, ...after];

  return { points: combined, detour };
}

/**
 * Known stop coordinate micro-adjustments for routing.
 * Some physical stop poles are placed on sidewalks or street corners closer to
 * side alleys or driveways than the main road, causing routing engines to detour
 * down residential alleys (e.g. Olimpijska in Szczyrk).
 */
export const ROUTE_STOP_ADJUSTMENTS: Record<string, LatLng> = {
  // SZCZYRK WODOSPAD (pole 21181 was snapping onto Olimpijska residential alley)
  "21181": [49.70298, 19.00137], // center of DW942 (ul. Myśliwska / Salmopolska)
  // SZCZYRK WIDOKOWA (pole 21231 was snapping onto a side driveway)
  "21231": [49.70051, 18.99644], // center of DW942
};

export function adjustStopRoutePoint(stopId: string | undefined, pt: LatLng): LatLng {
  if (!stopId) return pt;
  const adj = ROUTE_STOP_ADJUSTMENTS[stopId];
  return adj ?? pt;
}
