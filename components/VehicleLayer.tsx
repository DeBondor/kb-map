"use client";

import { memo, useMemo } from "react";
import { Marker, Tooltip } from "react-leaflet";
import { delayTxt, vehColor } from "@/lib/client/format";
import { makeVehicleIcon } from "@/lib/client/leafletIcons";
import type { Vehicle } from "@/lib/client/types";

interface Props {
  vehicles: Vehicle[];
  onVehicleClick: (v: Vehicle) => void;
  /** hide every live marker (e.g. while a trip route is drawn) so the selected
   *  vehicle isn't duplicated by TripLayer and the others don't obscure it */
  hidden?: boolean;
}

/** Bearing quantized to 5° so setIcon (which replaces the DOM node and kills
 *  the CSS glide) only fires on real heading/color changes. */
function bearingBucket(b: number | null): number | null {
  return b == null ? null : Math.round(b / 5) * 5;
}

const VehicleMarker = memo(function VehicleMarker({
  v,
  onClick,
}: {
  v: Vehicle;
  onClick: (v: Vehicle) => void;
}) {
  const color = vehColor(v);
  const bb = bearingBucket(v.bearing);
  const icon = useMemo(() => makeVehicleIcon(v.line, color, bb), [v.line, color, bb]);

  return (
    <Marker
      position={[v.lat, v.lon]}
      icon={icon}
      eventHandlers={{ click: () => onClick(v) }}
      zIndexOffset={100}
      keyboard={false}
    >
      <Tooltip direction="top" offset={[0, -16]} className="kb-tooltip">
        <b>{v.line || "?"}</b> {v.headsign ? `→ ${v.headsign}` : ""}
        {v.delay != null ? ` · ${delayTxt(v.delay)}` : ""}
      </Tooltip>
    </Marker>
  );
});

function VehicleLayer({ vehicles, onVehicleClick, hidden = false }: Props) {
  if (hidden) return null;
  return (
    <>
      {vehicles.map((v) => (
        <VehicleMarker key={v.id} v={v} onClick={onVehicleClick} />
      ))}
    </>
  );
}

export default memo(VehicleLayer);
