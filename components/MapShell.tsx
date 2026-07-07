"use client";

import dynamic from "next/dynamic";

/**
 * Leaflet touches `window` at import time, so the whole map tree is loaded
 * client-side only. Server components can't pass ssr:false — hence this
 * thin "use client" wrapper.
 */
const MapApp = dynamic(() => import("@/components/MapApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-6 animate-fade" role="status" aria-live="polite">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand.svg" alt="Komunikacja Beskidzka" className="h-14 w-auto" draggable={false} />
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-3 border-t-brand" />
        <p className="text-sm text-text-mute">Ładowanie mapy…</p>
      </div>
    </div>
  ),
});

export default function MapShell() {
  return <MapApp />;
}
