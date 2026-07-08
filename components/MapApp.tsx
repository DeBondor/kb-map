"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, ZoomControl, useMap } from "react-leaflet";
import type L from "leaflet";
import { fetchJSON, fetchRoute, getTrip } from "@/lib/client/api";
import { makeStopPingIcon, makeUserLocationIcon } from "@/lib/client/leafletIcons";
import type {
  LatLng,
  Stop,
  Trip,
  TripExecutionResponse,
  TripStopResolved,
  TripView,
  Vehicle,
} from "@/lib/client/types";
import { useGeolocation, useIsDesktop, useStops, useVehicles } from "@/components/hooks";
import LocateButton from "@/components/LocateButton";
import TopBar, { BASE_LAYERS, type BaseLayerId } from "@/components/TopBar";
import StopView from "@/components/StopView";
import TripPanel from "@/components/TripView";
import VehicleLayer from "@/components/VehicleLayer";
import StopsLayer from "@/components/StopsLayer";
import TripLayer from "@/components/TripLayer";
import VectorBaseLayer from "@/components/VectorBaseLayer";

const NOT_STARTED = "Pojazd jeszcze nie wyruszył";
const LAYER_KEY = "kb:baseLayer";

type LastRequest =
  | { kind: "live"; execId: string; tripId: string | number | null; stop: Stop | null }
  | { kind: "static"; tripId: string | number; stop: Stop | null };

function MapBridge({ onMap }: { onMap: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => onMap(map), [map, onMap]);
  return null;
}

function loadingTrip(
  gen: number,
  isLive: boolean,
  stop: Stop | null,
  note: string | null,
  execId: string | null,
): TripView {
  return {
    gen,
    isLive,
    status: "loading",
    note,
    line: "…",
    direction: "",
    rawTimes: [],
    stops: [],
    vehicle: null,
    vti: null,
    stop,
    routed: null,
    execId,
  };
}

export default function MapApp() {
  const { data: vehData, error: vehError } = useVehicles();
  const { data: stopsData } = useStops();
  const stops = useMemo(() => stopsData?.stops ?? [], [stopsData]);
  const vehicles = vehData?.vehicles ?? [];
  const desktop = useIsDesktop();

  const mapRef = useRef<L.Map | null>(null);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [stopsVisible, setStopsVisible] = useState(true);
  const [trip, setTrip] = useState<TripView | null>(null);
  const [vehMeta, setVehMeta] = useState<Vehicle | null>(null);
  const [baseLayer, setBaseLayerState] = useState<BaseLayerId>(() => {
    return "kb";
  });
  const genRef = useRef(0);
  const lastReqRef = useRef<LastRequest | null>(null);
  const stopPingIcon = useMemo(() => makeStopPingIcon(), []);
  const userIcon = useMemo(() => makeUserLocationIcon(), []);

  /* geolocation — the blue "you are here" dot follows the user once granted */
  const geo = useGeolocation();
  const wantFlyRef = useRef(false);

  const setBaseLayer = useCallback((id: BaseLayerId) => {
    setBaseLayerState(id);
    try {
      window.localStorage.setItem(LAYER_KEY, id);
    } catch {
      /* private mode — ignore */
    }
  }, []);

  /* fast stop lookup: by internal id and by designator */
  const stopsMaps = useMemo(() => {
    const byId = new Map<string, Stop>();
    const byDesig = new Map<string, Stop>();
    for (const s of stops) {
      byId.set(String(s.id), s);
      byDesig.set(String(s.designator), s);
    }
    return { byId, byDesig };
  }, [stops]);
  const stopsMapsRef = useRef(stopsMaps);
  useEffect(() => {
    stopsMapsRef.current = stopsMaps;
  }, [stopsMaps]);

  const closeTrip = useCallback(() => {
    genRef.current++;
    setTrip(null);
    setVehMeta(null);
  }, []);

  /** Resolve stop coords, publish trip state, then route it via OSRM.
   *  `gen` guards every async step so a newer trip cancels this one. */
  const buildTrip = useCallback(
    async (
      gen: number,
      tripData: Trip | null,
      vehicle: { lat: number; lon: number } | null,
      vti: number | null,
      stop: Stop | null,
      isLive: boolean,
      note: string | null,
      execId: string | null,
    ) => {
      if (gen !== genRef.current) return;
      const { byId, byDesig } = stopsMapsRef.current;
      const times = tripData?.times ?? [];
      const resolved: TripStopResolved[] = [];
      for (const t of times) {
        let c: Stop | undefined;
        if (t.designator != null) c = byId.get(String(t.designator));
        if (!c && t.place_id) c = byDesig.get(t.place_id);
        if (!c) continue;
        const selected =
          !!stop &&
          ((t.designator != null && String(t.designator) === String(stop.id)) ||
            t.place_id === stop.designator);
        resolved.push({ t, s: c, selected });
      }
      const pts: LatLng[] = resolved.map(({ s }): LatLng => [s.lat, s.lon]);
      const needRoute = pts.length >= 2;
      setTrip({
        gen,
        isLive,
        status: needRoute ? "routing" : "ready",
        note,
        line: tripData?.line?.name || "?",
        direction: tripData?.direction || "",
        rawTimes: times,
        stops: resolved,
        vehicle,
        vti,
        stop,
        routed: null,
        execId,
      });
      if (!needRoute) return;
      const road = await fetchRoute(pts);
      if (gen !== genRef.current) return;
      // OSRM road geometry when available; straight lines through the stops if not
      const routed = road && road.length >= 2 ? road : pts;
      setTrip((prev) => (prev && prev.gen === gen ? { ...prev, routed, status: "ready" } : prev));
    },
    [],
  );

  /* a trip opened before /api/stops resolved published an empty timeline —
     rebuild it against the freshly loaded stop index (same gen, no refetch) */
  const healedGenRef = useRef(-1);
  useEffect(() => {
    const t = trip;
    if (stopsMaps.byId.size === 0 || !t) return;
    if (t.gen !== genRef.current || t.gen === healedGenRef.current) return;
    if (t.rawTimes.length === 0 || t.stops.length > 0) return;
    healedGenRef.current = t.gen;
    void buildTrip(
      t.gen,
      { times: t.rawTimes, line: { name: t.line }, direction: t.direction },
      t.vehicle,
      t.vti,
      t.stop,
      t.isLive,
      t.note,
      t.execId,
    );
  }, [stopsMaps, trip, buildTrip]);

  const openTripStatic = useCallback(
    async (tripId: string | number, stop: Stop | null, note: string | null = null) => {
      if (!tripId) return;
      lastReqRef.current = { kind: "static", tripId, stop };
      const gen = ++genRef.current;
      setTrip(loadingTrip(gen, false, stop, note, null));
      let tr: Trip | null = null;
      try {
        tr = await getTrip(tripId);
      } catch {
        tr = null; // getTrip resolves null on failure; guard anyway so we never hang on the spinner
      }
      if (gen !== genRef.current) return;
      if (!tr || !tr.times?.length) {
        setTrip((prev) => (prev && prev.gen === gen ? { ...prev, status: "error" } : prev));
        return;
      }
      await buildTrip(gen, tr, null, null, stop, false, note, null);
    },
    [buildTrip],
  );

  const openTripLive = useCallback(
    async (execId: string, tripId: string | number | null, stop: Stop | null) => {
      if (!execId) {
        if (tripId) void openTripStatic(tripId, stop);
        return;
      }
      lastReqRef.current = { kind: "live", execId, tripId, stop };
      const gen = ++genRef.current;
      setTrip(loadingTrip(gen, true, stop, null, execId));
      try {
        const resp = await fetchJSON<TripExecutionResponse>(
          `/api/trip_execution?exec_id=${encodeURIComponent(execId)}`,
          { cache: "no-store" },
        );
        if (gen !== genRef.current) return;
        if (!resp || !resp.trip) {
          // upstream 404 → our API returns {} → vehicle has not departed yet
          if (tripId) void openTripStatic(tripId, stop, NOT_STARTED);
          else
            setTrip((prev) =>
              prev && prev.gen === gen ? { ...prev, status: "ready", note: NOT_STARTED } : prev,
            );
          return;
        }
        // coerce like the server parses the same payload (parsePosition):
        // upstream may send numeric strings; normalize to real numbers
        const vLat = Number(resp.vehicle?.lat);
        const vLon = Number(resp.vehicle?.lon);
        const veh =
          resp.vehicle && Number.isFinite(vLat) && Number.isFinite(vLon)
            ? { lat: vLat, lon: vLon }
            : null;
        await buildTrip(gen, resp.trip, veh, resp.vehicle_trip_index ?? null, stop, true, null, execId);
      } catch {
        if (gen !== genRef.current) return;
        setTrip((prev) => (prev && prev.gen === gen ? { ...prev, status: "error" } : prev));
      }
    },
    [buildTrip, openTripStatic],
  );

  const retryTrip = useCallback(() => {
    const req = lastReqRef.current;
    if (!req) return;
    if (req.kind === "live") void openTripLive(req.execId, req.tripId, req.stop);
    else void openTripStatic(req.tripId, req.stop);
  }, [openTripLive, openTripStatic]);

  const handleSelectStop = useCallback(
    (s: Stop, opts?: { fly?: boolean }) => {
      /* picking a stop while a trip route is drawn closes the trip so the
         stop sheet actually shows (no-op when no trip is open) */
      closeTrip();
      setSelectedStop(s);
      if (opts?.fly && mapRef.current) {
        const m = mapRef.current;
        m.flyTo([s.lat, s.lon], Math.max(m.getZoom(), 16), { duration: 1.1, easeLinearity: 0.22 });
      }
    },
    [closeTrip],
  );

  /* stable identities so memo(TopBar) survives the 5 s vehicle poll re-render */
  const toggleStops = useCallback(() => setStopsVisible((v) => !v), []);
  const pickStopFly = useCallback((s: Stop) => handleSelectStop(s, { fly: true }), [handleSelectStop]);

  /* stable identities for the memo()-ized sheets (TripPanel / StopView) */
  const handleCloseAll = useCallback(() => {
    closeTrip();
    setSelectedStop(null);
  }, [closeTrip]);

  const handleCloseStop = useCallback(() => setSelectedStop(null), []);

  const handleShowLive = useCallback(
    (execId: string, tripId: string | number | null) => {
      setVehMeta(null);
      void openTripLive(execId, tripId, selectedStop);
    },
    [openTripLive, selectedStop],
  );

  const handleShowStatic = useCallback(
    (tripId: string | number) => {
      setVehMeta(null);
      void openTripStatic(tripId, selectedStop);
    },
    [openTripStatic, selectedStop],
  );

  const handleVehicleClick = useCallback(
    (v: Vehicle) => {
      setVehMeta(v);
      void openTripLive(v.id, null, null);
    },
    [openTripLive],
  );

  /* fly to a stop tapped on the trip timeline (does not change selection) */
  const handleFocusStop = useCallback((s: Stop) => {
    const m = mapRef.current;
    if (m) m.flyTo([s.lat, s.lon], Math.max(m.getZoom(), 15), { duration: 0.9, easeLinearity: 0.22 });
  }, []);

  const handleMap = useCallback((m: L.Map) => {
    mapRef.current = m;
  }, []);

  /* locate button: start (or reuse) the GPS watch and recenter on the fix */
  const flyToUser = useCallback((p: { lat: number; lon: number }) => {
    const m = mapRef.current;
    if (m) m.flyTo([p.lat, p.lon], Math.max(m.getZoom(), 15), { duration: 1.1, easeLinearity: 0.22 });
  }, []);

  const handleLocate = useCallback(() => {
    // watch already running → a second tap turns it off (stops the GPS drain)
    if (geo.status === "active" || geo.status === "locating") {
      wantFlyRef.current = false;
      geo.stop();
      return;
    }
    if (geo.pos) flyToUser(geo.pos);
    else wantFlyRef.current = true; // fly once the first fix arrives
    geo.locate();
  }, [geo, flyToUser]);

  /* first fix after a locate request → recenter exactly once */
  useEffect(() => {
    if (wantFlyRef.current && geo.pos) {
      wantFlyRef.current = false;
      flyToUser(geo.pos);
    }
  }, [geo.pos, flyToUser]);

  const tiles = BASE_LAYERS[baseLayer];
  /* trip opened from a stop → back returns to that stop's sheet */
  const tripFromStop = !!trip && trip.stop != null && selectedStop != null;

  /* live fix for the open trip: the 5 s /api/vehicles poll keeps the drawn
     vehicle's position, heading, delay and current stop fresh (matched by
     exec id) — so it moves on the map and advances the timeline without
     re-opening the route. null once the vehicle drops off the live feed. */
  const liveTripVeh =
    trip?.isLive && trip.execId ? vehicles.find((v) => v.id === trip.execId) ?? null : null;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg">
      <MapContainer
        center={[49.822, 19.046]}
        zoom={11}
        maxZoom={19}
        zoomControl={false}
        className="absolute inset-0 z-0 h-full w-full"
      >
        <MapBridge onMap={handleMap} />
        {tiles.kind === "vector" ? (
          <VectorBaseLayer key={baseLayer} style={tiles.style} filter={tiles.filter} />
        ) : (
          <TileLayer key={baseLayer} url={tiles.url} maxZoom={19} attribution={tiles.attribution} />
        )}
        <ZoomControl position="bottomright" />
        <StopsLayer stops={stops} visible={stopsVisible} onSelect={handleSelectStop} />
        {selectedStop && (
          <Marker
            position={[selectedStop.lat, selectedStop.lon]}
            icon={stopPingIcon}
            interactive={false}
            keyboard={false}
          />
        )}
        <TripLayer trip={trip} desktop={desktop} vehMeta={vehMeta} liveVehicle={liveTripVeh} />
        {/* while a route is drawn, hide the live fleet: the selected vehicle is
            already drawn by TripLayer (no duplicate) and the rest won't obscure it */}
        <VehicleLayer vehicles={vehicles} onVehicleClick={handleVehicleClick} hidden={trip != null} />
        {geo.pos && (
          <>
            {geo.pos.accuracy > 0 && geo.pos.accuracy < 2000 && (
              <Circle
                center={[geo.pos.lat, geo.pos.lon]}
                radius={geo.pos.accuracy}
                pathOptions={{ color: "#2b83ff", weight: 1, opacity: 0.5, fillColor: "#2b83ff", fillOpacity: 0.1 }}
                interactive={false}
              />
            )}
            <Marker
              position={[geo.pos.lat, geo.pos.lon]}
              icon={userIcon}
              interactive={false}
              keyboard={false}
              zIndexOffset={300}
            />
          </>
        )}
      </MapContainer>

      <TopBar
        count={vehData?.count ?? null}
        lastScan={vehData?.last_scan ?? null}
        scanCount={vehData?.scan_count ?? null}
        offline={!!vehError}
        stops={stops}
        vehicles={vehicles}
        stopsVisible={stopsVisible}
        onToggleStops={toggleStops}
        onPickStop={pickStopFly}
        onPickVehicle={handleVehicleClick}
        baseLayer={baseLayer}
        onBaseLayer={setBaseLayer}
      />

      <LocateButton status={geo.status} onLocate={handleLocate} />

      {/* one sheet at a time: an open trip takes precedence over the stop */}
      {trip ? (
        <TripPanel
          key={trip.gen}
          trip={trip}
          desktop={desktop}
          vehMeta={vehMeta}
          liveVeh={liveTripVeh}
          onBack={tripFromStop ? closeTrip : null}
          onClose={handleCloseAll}
          onFocusStop={handleFocusStop}
          onRetry={retryTrip}
        />
      ) : (
        selectedStop && (
          <StopView
            key={selectedStop.designator}
            stop={selectedStop}
            desktop={desktop}
            onClose={handleCloseStop}
            onShowLive={handleShowLive}
            onShowStatic={handleShowStatic}
          />
        )
      )}
    </div>
  );
}
