/** Shared client-side types mirroring the /api/* contract. */

export interface Vehicle {
  id: string;
  trip_id: string;
  route_id: string;
  line: string;
  headsign: string;
  lat: number;
  lon: number;
  vehicle_type: number;
  current_stop_sequence: number;
  at_stop: boolean;
  delay: number | null;
  bearing: number | null;
  next_stop_name: string | null;
  next_stop_lat: number | null;
  next_stop_lon: number | null;
  timestamp: number;
  updated_at: number;
}

export interface VehiclesResponse {
  timestamp: number;
  scan_count: number;
  last_scan: number;
  count: number;
  vehicles: Vehicle[];
}

export interface Stop {
  id: string;
  designator: string;
  name: string;
  lat: number;
  lon: number;
  /** up to two GTFS-derived travel bearings (deg) buses leave this stop on */
  dirs?: number[];
}

export interface StopsResponse {
  count: number;
  stops: Stop[];
}

/** Upstream departures passthrough row. */
export interface DepartureRow {
  trip_execution_id?: string;
  trip_id?: number | string;
  static_time?: string;
  time?: string;
  time_diff?: number;
  is_estimated?: boolean;
  direction?: string;
  platform?: string;
  line_name?: string;
  symbol?: string;
}

export interface DeparturesResponse {
  rows?: DepartureRow[];
}

export interface TimetableDeparture {
  trip_id: number | string;
  departure: number;
  platform?: string;
}

export interface TimetableResponse {
  departures?: TimetableDeparture[];
  main_direction?: { name?: string };
}

export interface TripTime {
  stop_name: string;
  designator?: number;
  place_id?: string;
  departure_time: string;
  index: number;
  platform?: string;
  estimate?: { time_diff?: number };
}

export interface Trip {
  times?: TripTime[];
  direction?: string;
  line?: { name?: string };
}

export interface TripExecutionResponse {
  trip?: Trip;
  vehicle?: { lat: number; lon: number };
  vehicle_trip_index?: number;
}

export type LatLng = [number, number];

/** Resolved trip stop: schedule entry + matched physical stop. */
export interface TripStopResolved {
  t: TripTime;
  s: Stop;
  selected: boolean;
}

export type TripStatus = "loading" | "routing" | "ready" | "error";

/** All state describing the currently drawn trip route. */
export interface TripView {
  gen: number;
  isLive: boolean;
  status: TripStatus;
  /** Extra notice, e.g. vehicle has not departed yet. */
  note: string | null;
  line: string;
  direction: string;
  rawTimes: TripTime[];
  stops: TripStopResolved[];
  vehicle: { lat: number; lon: number } | null;
  vti: number | null;
  stop: Stop | null;
  routed: LatLng[] | null;
  /** upstream trip-execution id — lets the live /api/vehicles poll keep the
   *  drawn vehicle's position, heading and current stop fresh while the route
   *  is open (matched by Vehicle.id). null for static (rozkładowy) trips. */
  execId: string | null;
}
