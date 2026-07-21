# Komunikacja Beskidzka — GTFS + GTFS-Realtime

Scraper i serwer mapy dla [Komunikacji Beskidzkiej](https://komunikacjabeskidzka.kiedyprzyjedzie.pl).
Generuje statyczny feed **GTFS** oraz feed **GTFS-RT (VehiclePositions)** w protobufie z pozycjami wszystkich pojazdów na żywo, plus mapę Leaflet pokazującą wszystkie autobusy jednocześnie (a nie per-przystanek jak oryginał).

Aplikacja to **Next.js 16 + TypeScript**: jeden proces Node serwuje mapę, JSON API i protobuf, a scraper live działa w tle w tym samym procesie (startowany automatycznie przez `instrumentation.ts`). Stary kod Pythona/FastAPI został usunięty z projektu.

## Wymagania

- Node.js 20+ (testowane na 24)
- Windows / Linux / macOS

```bash
npm install
```

## Struktura

```
kb-gtfs/
  app/                # Next.js App Router: strona mapy + endpointy /api/*
  components/         # komponenty React (mapa Leaflet itd.)
  lib/                # klient API KiedyPrzyjedzie, poller live, konfiguracja, budowanie GTFS-RT
  scripts/
    build-gtfs.ts     # builder statycznego GTFS (CLI, uruchamiany przez tsx)
  instrumentation.ts  # startuje poller live razem z serwerem Next.js
  output/
    gtfs/             # wygenerowany statyczny GTFS (agency/stops/routes/trips/stop_times/shapes/calendar/feed_info + .zip)
```

## 1. Statyczny GTFS

```bash
npm run build:gtfs -- --date 2026-07-07
```

Opcje (po `--`):

| Opcja | Domyślnie | Opis |
|---|---|---|
| `--date YYYY-MM-DD` | dziś | dzień serwisu |
| `--out <dir>` | `output/gtfs` | katalog wyjściowy |
| `--concurrency N` | 40 | równoległość HTTP |
| `--no-zip` | (pakuje) | nie twórz `kb_gtfs.zip` |

Wynik w `output/gtfs/`:
- `stops.txt` — 956 przystanków z coords
- `routes.txt` — linie (route_type=3 bus)
- `trips.txt` — kursy z headsign i shape_id
- `stop_times.txt` — czasy per przystanek
- `shapes.txt` — geometria tras (punkty per przystanek)
- `calendar.txt` — serwis na dany dzień
- `agency.txt`, `feed_info.txt`
- `kb_gtfs.zip` — paczka gotowa do importu

## 2. Mapa live + GTFS-RT

Tryb deweloperski:

```bash
npm run dev
```

Tryb produkcyjny:

```bash
npm run build
npm start
```

Serwer na `http://localhost:8080`:

| Endpoint | Opis |
|---|---|
| `/` | Mapa Leaflet z pojazdami na żywo |
| `/api/vehicles` | Pozycje wszystkich pojazdów (JSON) |
| `/api/gtfs-rt.pb` | **GTFS-RT VehiclePositions** (protobuf, standard) |
| `/api/stops` | Wszystkie przystanki (JSON) |
| `/api/lines` | Statyczny katalog linii z GTFS `routes.txt` (JSON; pusty gdy brak zbudowanego feedu) |
| `/api/stop/<designator>/departures` | Najbliższe odjazdy z przystanku (proxy do upstream) |
| `/api/stop/<designator>/timetable?date=YYYY-MM-DD` | Rozkład przystanku na dzień, domyślnie dziś (proxy do upstream) |
| `/api/trip/<tripId>?index=0` | Szczegóły kursu z rozkładu (proxy do upstream) |
| `/api/trip_execution?exec_id=<id>&index=0` | Realizacja kursu — pozycja pojazdu; `exec_id` surowy, base64 robi serwer (proxy do upstream) |
| `/api/announcements` | Komunikaty przewoźnika (proxy do upstream) |
| `/api/health` | Status + liczniki |

Mapa odświeża się automatycznie co kilka sekund. Pokazuje wszystkie pojazdy naraz, z kolorami linii, statusem (w trasie/na przystanku/opóźniony) i popupem (linia, kierunek, opóźnienie, trip_id).

## Jak działa scrapowanie live

Serwer nie wie z góry, które pojazdy jeżdżą. Poller (startowany razem z serwerem przez `instrumentation.ts`) pracuje w trzech rytmach:

1. **Pełny skan co 180 s** (`KB_SCAN_INTERVAL`): odpytuje batched `/api/departures?places=...` dla **wszystkich 956 przystanków** w paczkach (domyślnie 100 przystanków na paczkę i 40 równoległych połączeń), zbiera unikalne `trip_execution_id` z aktywnych odjazdów (horyzont 2 h, `KB_CANDIDATE_HORIZON`), deduplikuje i odpytuje `/api/trip_execution/<base64(id)>/0` → `{vehicle:{lat,lon}, vehicle_trip_index, at_stop, ...}`
2. **Smart scan co 60 s** (`KB_SMART_SCAN_INTERVAL`): tańszy skan przyrostowy pomiędzy pełnymi — wyłapuje nowe kursy bez odpytywania wszystkich przystanków
3. **Refresh co 15 s** (`KB_REFRESH_INTERVAL`): odświeża pozycje tylko już aktywnych pojazdów

404 dla `trip_execution` (kurs zeskanowany, ale pojazd jeszcze nie ruszył) jest cache'owane na 240 s (`KB_404_CACHE`).

`trip_execution_id` jest base64 formatu `<line_id>:<trip_id>:<variant>` (np. `6404:739777:0`), osobnej przestrzeni niż statyczny `trip_id` — dlatego pozycje da się zdobyć tylko przez departures, nie z planu.

## Notatki

- 0 pojazdów po północy = normalne (nic nie jeździ). Pozycje pojawiają się w godzinach pracy (ok. 4:30–22:00).
- `data-stops-revision` jest wykrywane automatycznie z HTML strony głównej (fallback: `6829`).
- Podkład mapy to wektorowe kafelki OpenFreeMap (styl „liberty", bezkluczowe i możliwe do self-hostingu) — mapa renderuje się w całości u nas, bez zależności od `maps.i.kiedyprzyjedzie.pl`.
- Poller startuje w procesie Next.js — nie ma osobnego procesu scrapera. `npm run dev` też go uruchamia.
- Konfiguracja przez zmienne środowiskowe z prefiksem `KB_` (patrz niżej) — żadna nie jest wymagana, wszystko ma sensowne wartości domyślne.

## Produkcja

### Build standalone

`next.config.ts` ma `output: "standalone"` — `npm run build` tworzy w `.next/standalone` samowystarczalny serwer z minimalnym `node_modules`:

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public   # jeśli katalog istnieje
PORT=8080 HOSTNAME=0.0.0.0 node .next/standalone/server.js
```

Lokalnie wystarczy też zwykłe `npm run build && npm start` (port 8080). Na Windows: `start.bat` / `stop.bat`.

### Docker

```bash
docker build -t kb-gtfs .
docker run -d --name kb-gtfs -p 8080:8080 kb-gtfs
```

albo przez compose (opcjonalnie czyta `.env` z katalogu projektu):

```bash
docker compose up -d --build
```

### Zmienne środowiskowe

Wzór w `.env.example`. Wszystkie opcjonalne:

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `KB_BASE_URL` | `https://komunikacjabeskidzka.kiedyprzyjedzie.pl` | adres bazowy upstream API |
| `KB_CONCURRENCY` | `40` | równoległość HTTP scrapera |
| `KB_HTTP_TIMEOUT` | `20` | timeout zapytania HTTP (s) |
| `KB_SCAN_INTERVAL` | `180` | pełny skan wszystkich przystanków (s) |
| `KB_SMART_SCAN_INTERVAL` | `60` | smart scan (s) |
| `KB_REFRESH_INTERVAL` | `15` | odświeżanie pozycji aktywnych pojazdów (s) |
| `KB_CANDIDATE_HORIZON` | `7200` | horyzont odjazdów przy skanie (s) |
| `KB_404_CACHE` | `240` | cache odpowiedzi 404 dla trip_execution (s) |
| `KB_BATCH_SIZE` | `6` | rozmiar paczki zapytań przy skanie (upstream ucina odpowiedź do 6 tablic na zapytanie — większe wartości gubią przystanki) |
| `KB_HEALTH_STALE_SEC` | `1200` | wiek feedu (s od ostatniego potwierdzonego kontaktu z upstreamem), po którym `/api/health` zgłasza `degraded` (HTTP 503) |
| `KB_STOPS_RELOAD_SEC` | `86400` | jak często poller przeładowuje listę przystanków (s); nieudany reload zachowuje starą listę i ponawia za 30 min |
| `KB_GTFS_AUTOBUILD` | `1` | automatyczna nocna przebudowa feedu GTFS w procesie serwera (`0` wyłącza) |
| `KB_GTFS_BUILD_HOUR` | `3` | godzina (czasu Europe/Warsaw), po której feed z wczorajszą datą jest przebudowywany; brak feedu = build od razu (bootstrap) |
| `KB_GTFS_BUILD_CONCURRENCY` | `10` | równoległość HTTP nocnej przebudowy (mniejsza niż CLI, bo serwer równolegle skanuje) |
| `PORT` | `8080` | port serwera HTTP |

### Healthcheck

`GET /api/health` zwraca status i liczniki:

```json
{
  "status": "ok",
  "stops": 956,
  "scan_count": 12,
  "last_scan": 1753100000,
  "vehicles": 34,
  "tracked": 41,
  "last_refresh": 1753100010,
  "last_good_refresh": 1753100010,
  "feed_age_secs": 4,
  "loop_restarts": 0,
  "last_loop_error": null,
  "stops_loaded_at": 1753090000
}
```

`status` przechodzi w `degraded` (i odpowiedź w HTTP 503 — co przewraca `HEALTHCHECK` w Dockerfile i `compose.yaml`), gdy pętla skanująca utknęła (brak skanu przez ponad 2×`KB_SCAN_INTERVAL`+120 s) **lub** ostatni potwierdzony kontakt z upstreamem jest starszy niż `KB_HEALTH_STALE_SEC`. Celowo bez warunku na liczbę pojazdów — 0 wozów w nocy to norma. `vehicles` to pojazdy widoczne na mapie; `tracked` obejmuje też celowo ukryte "duchy".
