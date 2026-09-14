<div align="center">

# kb-map

Real-time bus tracking, GTFS / GTFS-RT feed generator, and multi-leg transit journey planner for **Komunikacja Beskidzka** (Bielsko-Biała region, Poland).

<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-20%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node"></a>
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/next.js-16-000000?style=flat-square&logo=next.js&logoColor=white" alt="Next.js"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/typescript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="/api/gtfs-rt.pb"><img src="https://img.shields.io/badge/GTFS--RT-protobuf-blue?style=flat-square" alt="GTFS-RT"></a>
</p>

</div>

Official passenger portals only show departures one stop at a time. **kb-map** tracks the entire fleet at once: real-time vehicle positions with live delays on an interactive vector map, an automated GTFS / GTFS-RT feed generator, and a journey planner that computes direct and multi-leg transfers across 950+ stops.

Built with **Next.js 16**, **TypeScript**, and **Leaflet / MapLibre GL**. A background poller runs concurrently in the same Node.js process via `instrumentation.ts` — no separate scraper daemon required.

## Features

- **Live Fleet Tracking** — Real-time GPS locations of all running buses updated every 4 s. Headings are computed from actual physical movement (with jitter filtering), with live delay badges (`+4 min`) and active stop progress tracking.
- **Multi-leg Journey Planner** — Connection search supporting direct trips and multi-leg transfers with automatic walkable hub transfers (up to 350 m between platforms or opposite street sides). Fuzzy stop resolution handles Polish diacritics, punctuation (`PIETRZYKOWICE, KOŚCIÓŁ`), and street suffixes seamlessly across calendar boundaries.
- **GTFS & GTFS-Realtime Feeds** — Automatic nightly builds of static multi-day GTFS (`stops`, `routes`, `trips`, `stop_times`, `shapes`, `calendar`) published atomically, plus standard GTFS-RT `VehiclePositions` protobuf at `/api/gtfs-rt.pb`.
- **Interactive UI & PWA** — Vector base map (OpenFreeMap with dark mode and raster fallback), stop departures boards with live countdowns, route timeline sheets with OSRM road geometry, keyboard command palette (`Cmd/Ctrl+K`), and installable PWA support.
- **Self-Healing Poller** — 3-tier polling architecture (full scan every 180 s, smart scan every 60 s, active vehicle refresh every 15 s) with on-demand candidate discovery, ghost vehicle filtering, and health monitoring (`/api/health`).

## Quick Start

Requirements: **Node.js 20+** (tested on Node 24).

```bash
# Clone and install dependencies
git clone https://github.com/DeBondor/kb-map.git
cd kb-map
npm install

# Run development server (runs scraper + web UI on port 8080)
npm run dev

# Or build for production
npm run build
npm start
```

### Docker

```bash
docker compose up -d --build
```

The app is served at `http://localhost:8080`.

## API & Feeds

| Endpoint | Description |
|---|---|
| `/` | Interactive live fleet map & journey planner UI |
| `/api/vehicles` | All active vehicle positions with delays and heading (`JSON`) |
| `/api/gtfs-rt.pb` | Standard **GTFS-RT VehiclePositions** (`protobuf`) |
| `/api/connections?from=...&to=...` | Transit routing engine (direct & transfer itineraries) |
| `/api/stops` | All 950+ stops with coordinates and platform metadata |
| `/api/lines` | Active bus lines catalog extracted from GTFS |
| `/api/stop/:id/departures` | Live & scheduled departures for a specific stop |
| `/api/health` | Service health status, vehicle count, and feed freshness |

## Static GTFS Generation

To build or refresh the static GTFS schedule manually:

```bash
npm run build:gtfs
```

Options: `--date YYYY-MM-DD` (default: today), `--out <dir>` (default: `output/gtfs`), `--concurrency <N>` (default: 40), `--single-day` (default: multi-day full schedule).

Output is written atomically to `output/gtfs/` (including `kb_gtfs.zip`).
