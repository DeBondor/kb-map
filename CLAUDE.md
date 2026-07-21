# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Komunikacja Beskidzka live bus map: a Next.js 16 (App Router, TypeScript strict) app where **one Node process** serves the Leaflet map UI, a JSON API, a GTFS-RT VehiclePositions protobuf feed, and runs the live scraper poller in-process. The upstream is `https://komunikacjabeskidzka.kiedyprzyjedzie.pl` (KiedyPrzyjedzie). The `lib/` layer is a deliberate behavioral-parity TypeScript port of a former Python codebase — see Gotchas. README.md (Polish) documents endpoints and env vars in detail.

## Commands

```bash
npm run dev          # next dev on port 8080 (poller starts too — dev mode scrapes upstream)
npm run build        # next build (output: "standalone")
npm start            # node scripts/start-server.mjs — syncs .next/static + public into
                     #   .next/standalone, then runs node .next/standalone/server.js
                     #   (falls back to `next start` if no standalone build exists)
npm run lint         # eslint .
npm run typecheck    # tsc --noEmit
npm test             # node --import tsx --test "test/**/*.test.ts" — pure-function tests
npm run build:gtfs -- --date 2026-07-05   # static GTFS builder CLI (logic lives in lib/gtfs-builder.ts)
                     #   flags: --date YYYY-MM-DD, --out DIR, --concurrency N, --no-zip
```

Verification is `npm run typecheck` + `npm run lint` + `npm test` + exercising the running app (`/api/health` shows status/scan counters). CI (`.github/workflows/ci.yml`) runs all four plus `next build` and `npm audit --audit-level=high`; it must never run `build:gtfs` (hits the live upstream). Tests in `test/` **pin Python-parity semantics** — a failing parity test means a regression in lib code, never "fix" the expectation.

Default port is **8080** everywhere (dev, start script, Dockerfile, compose), not 3000. Docker: `docker compose up -d --build`; healthchecks hit `/api/health`.

Config is via `KB_*` env vars (see `.env.example`), all optional. `lib/config.ts` reads them **at module load** — changing one requires a process restart.

## Architecture

### Backend data flow

```
instrumentation.ts register()            (Next instrumentation hook, nodejs runtime only)
  └─> lib/poller-singleton.ts startPoller()   (idempotent; singleton on globalThis)
        └─> lib/poller.ts LivePoller          (background loop, in-memory positions Map)
              └─> lib/kb-api.ts KbApi         (fetch + p-limit concurrency 40, retries)
                    └─> upstream API
```

- Routes under `app/api/` read poller snapshots: `/api/vehicles` (`toJson()`), `/api/gtfs-rt.pb` (`toProtobuf()`, gtfs-realtime-bindings), `/api/stops`, `/api/health`. Every route **also** `await startPoller()` as a lazy fallback, so the poller starts even if instrumentation didn't fire.
- Passthrough routes (`/api/trip/[tripId]`, `/api/trip_execution`, `/api/stop/[designator]/departures|timetable`, `/api/announcements`) proxy the upstream directly, gated by `lib/rate-limit.ts` (in-memory per-IP token bucket) and `lib/api-helpers.ts` validation.
- Poller rhythm: full scan of all ~956 stops every 180 s, smart incremental scan every 60 s, position refresh of active vehicles every 15 s. It discovers `trip_execution_id`s from departures (the only way to get positions — they live in a different ID space than static `trip_id`). The loop runs under `supervise()` — a crash restarts it with capped backoff (`loopRestarts` in health). The stop list reloads daily (`KB_STOPS_RELOAD_SEC`) with an atomic map swap; a failed reload keeps the old list.
- `/api/health` returns `"degraded"` + HTTP 503 (flips Docker healthchecks) when the scan loop stalls or upstream contact exceeds `KB_HEALTH_STALE_SEC` (1200 s > the 600 s overnight all-cached window). Deliberately no vehicle-count condition — 0 at night is normal.
- `lib/gtfs-refresh.ts` (armed from `startPoller()`, HMR-safe singleton) rebuilds the GTFS feed in-process: immediately when `output/gtfs` is missing (fresh Docker volume), else daily after `KB_GTFS_BUILD_HOUR` Warsaw time, then invalidates the stop-directions/lines caches. It exists because the standalone image ships no tsx/scripts — builder logic lives in `lib/gtfs-builder.ts`, `scripts/build-gtfs.ts` is just the CLI. Compose mounts the named volume `kb-output:/app/output`.
- `lib/stop-directions.ts` derives stop direction arrows from pre-built GTFS files in `output/gtfs/`; missing files silently yield no arrows. Cached per process until `invalidateStopDirections()`/`invalidateLines()` (called after a rebuild); `/api/stops` re-serializes when either the stop-list or the directions-map identity changes.

### Frontend

All components are `"use client"`. `app/page.tsx` → `components/MapShell.tsx`, which is the **single SSR boundary**: `dynamic(import MapApp, { ssr: false })` because Leaflet touches `window` at import time. Never import leaflet/maplibre outside that boundary.

- `MapApp.tsx` is the single stateful root — no state library; all state flows down as props. It re-renders every 5 s from the vehicle poll, so children (TopBar, VehicleLayer, StopsLayer, TripLayer, StopView, TripView) are `memo()`-ized and every callback prop must be `useCallback`-stable.
- Data fetching: SWR only for `/api/vehicles` (5 s poll, the app heartbeat) and `/api/stops` (once). Everything else is manual `fetch` with AbortController via `lib/client/api`.
- Trip opening uses generation-counter cancellation (`genRef` in MapApp): every async step re-checks `gen !== genRef.current` before setState. New async paths there must do the same or stale trips overwrite newer ones.
- `VectorBaseLayer` (MapLibre GL vector tiles from OpenFreeMap inside Leaflet's tile pane) and `StopsLayer` (raw `L.layerGroup`, viewport-culled and diffed, zoom ≥ 14) are imperative escape hatches — do not convert StopsLayer to declarative react-leaflet markers.
- `VehicleLayer` returns null while a trip is open; `TripLayer` draws the tracked vehicle itself, matched from the 5 s poll by `vehicle.id === trip.execId`.
- Deep links: view state lives in the URL (`?stop=`, `?exec=`, `?trip=`, `?lines=`, `?map=` — codec in `lib/client/urlState.ts`) via the **plain History API, never `next/navigation`** (`useSearchParams` would subscribe the whole map tree to every `moveend` replaceState). MapApp's single sync effect is the only URL writer; `popstate` is close-only (Android back closes sheets, state stays authoritative). `exec=` and `trip=` are separate params because the two trip-ID spaces can't be told apart heuristically.
- Announcements ("Utrudnienia"): `lib/client/announcements.ts` is a module-level `useSyncExternalStore` store (same pattern as `favorites.ts`) polling `/api/announcements` every 15 min; unread = upstream `hash` vs `kb:annSeen` in localStorage. Never wire it into the 5 s poll cycle.
- PWA updates: `public/sw.js` deliberately does **not** `skipWaiting()` on install — a new SW waits until `PwaRegister`'s toast posts `SKIP_WAITING`, and the reload on `controllerchange` only fires after explicit accept (`clients.claim()` fires it on first install too — an unconditional reload would refresh every new visitor).

### Single-process assumption

Poller singleton, rate-limit buckets, and stop-directions cache are all in-memory state in one long-lived Node process. Serverless or multi-instance deployment breaks rate limiting and multiplies upstream load. The singleton lives on `globalThis` under `Symbol.for("kb-gtfs.poller-singleton")` specifically to survive dev-mode HMR — never construct `LivePoller`/`KbApi` directly; go through `lib/poller-singleton.ts`.

## Gotchas

- **Python parity is intentional.** `pyTruthy`, `parseIntStrict`, etc. in `lib/kb-api.ts` replicate Python truthiness/`int()` semantics and are used across lib and routes; do not "simplify" them to JS truthiness. Likewise "JSON parse errors are not retried" is parity, not an oversight. An empty `{}` from a passthrough route means "upstream returned nothing" (e.g. vehicle not departed yet), not an error.
- **404 cache must not re-stamp.** In `lib/poller.ts` a candidate skipped due to a fresh cached 404 keeps its original timestamp — scan interval (180 s) < 404 cache (240 s), so re-stamping would slide the TTL forever and permanently hide a late-dispatched bus.
- **Ghost vehicles.** Upstream never 404s dead trips; it keeps returning the last position. Filtering relies on movement anchors (`anchorLat/anchorLon/lastMovedAt`, 15 m epsilon), staleness (frozen 300 s with no delay estimate), and `pruneDead`. The internal `positions` Map may contain vehicles that `liveVehicles()`/`toJson()` deliberately hide.
- **Time math is agency-local.** All schedule math uses seconds-since-midnight in Europe/Warsaw via `Intl` (`nowSecs()`), not server-local time, with ±43200 s midnight wrap — servers run UTC.
- **Upstream data quirks.** Positions can be bogus (0,0) — rejected via hardcoded SERVICE_AREA bbox (lat 48.8–50.5, lon 18.0–20.5). Stop coords arrive as micro-degrees (÷1e6). `trip_execution_id` is base64-encoded (`b64ExecId`) before hitting upstream URLs. `/api/departures?places=` silently caps the response at **6 boards per request** (extra stops are just absent) — hence `KB_BATCH_SIZE=6`; a board absent from the reply means truncation, not an empty stop (empty stops still get a board with empty rows), so the poller must not stamp the empty-cache for it.
- **Two stop ID spaces.** `Stop.urlId` (URL designator, may contain `:`) vs numeric `internalId`/`stopId`. On the frontend, trip time entries match `time.designator → Stop.id` and `time.place_id → Stop.designator` — not interchangeable.
- **Marker icons key on primitives on purpose.** `VehicleLayer`/`TripLayer` memoize `L.DivIcon` on line/color/5°-bucketed bearing, with `eslint-disable react-hooks/exhaustive-deps` comments. "Fixing" the deps rebuilds the DOM node every 5 s poll and kills the CSS position glide (markers teleport).
- **New passthrough routes must keep the security trio:** `isValidId`/`isValidDate` input validation (blocks URL injection into upstream paths), `upstreamError()` (generic 502, never leaks upstream details), and the rate-limit gate. `/api/trip_execution` skips `isValidId` deliberately because the id is base64-encoded first.
- Route handlers use the Next 15+ async params shape: `ctx.params` is a Promise and must be awaited. All API routes set `dynamic = "force-dynamic"` and `runtime = "nodejs"`.
- `output/` is generated (GTFS feeds, logs), gitignored, and eslint-ignored — not stray files.
- 0 vehicles after midnight is normal; buses run ~4:30–22:00.
