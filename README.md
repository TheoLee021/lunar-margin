# Lunar Margin

A mission decision tool for comparing landing sites and landing dates near the lunar south pole. It does not stop at showing environment data: it checks each site against the mission's requirements and says which requirement fails and by how much.

## What it does

The app walks through four stages. Each stage is linked from the stage bar at the top of the screen, and the current mission (dates, duration, limits, selected site) travels in the URL.

| #   | Stage           | URL                  | What you do there                                                                                                                                                         |
| --- | --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Search          | `/`                  | Enter a landing date, a mission duration and up to six limits: minimum sunlight and communication, maximum darkness, communication blackout, regional slope and roughness |
| 2   | Schedule & Cost | `/explore?planner=1` | Compare departure and landing dates by estimated delivery cost, pick a launch from the schedule and view the Earth–Moon flight trajectory                                 |
| 3   | Compare Sites   | `/explore?compare=1` | Review the shortlisted sites of the saved search over the Moon: metrics, why other sites were excluded, prices and reservation status                                     |
| 4   | 3D Explore      | `/explore`           | Inspect the top five candidates on the 3D Moon                                                                                                                            |

The 3D Explore stage has:

- **Left panel**: the mission schedule, the applied search conditions and the top five candidates by search score.
- **Right panel** for the selected candidate: alerts (shadowed at landing, a metric outside a search limit), six saved metrics (sunlight, communication, longest darkness, longest communication outage, local slope, local roughness), margins against each limit, and a timeline of Sun and Earth elevation over the mission.
- **Bottom toolbar**: sunlight or photo rendering, top view, 3D view of the selected point, Earth direction, and a viewshed panel that compares how much surrounding terrain each candidate sees from a chosen observer height.
- **Candidate comparison**: a radar chart and tables of the checked candidates' metrics and margins.

Other views:

| URL               | View                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `/?view=analysis` | Detailed analysis of any point picked on the Moon: illumination and Earth visibility over a period |
| `/?view=search`   | Candidate search: run a new search and follow how the grid is narrowed down step by step           |
| `/orbit`          | Earth–Moon transfer orbit for the selected departure and arrival dates                             |
| `/flight`         | The same page opened on the descent and landing part of the flight                                 |

## Quick start

Requirements: Docker, or Python 3.14 with [uv](https://docs.astral.sh/uv/) for the backend; Node 24 for the frontend.

```sh
# 1. NASA data, once (about 500 MB, saved to api/data, never committed)
docker compose run --rm api python -m lunar_margin.pipeline.fetch

# 2. Backend at http://localhost:8000 (restarts when api/src changes)
docker compose up --build

# 3. Frontend at http://localhost:5173 (/api is proxied to localhost:8000)
cd web
npm install
cp .env.example .env
npm run dev
```

To develop the backend without Docker:

```sh
cd api
uv sync
cp .env.example .env
uv run python -m lunar_margin.pipeline.fetch
uv run fastapi dev src/lunar_margin/app/main.py
```

### Configuration

| Variable                | Where      | Purpose                                                                                                          |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `VITE_CESIUM_ION_TOKEN` | `web/.env` | Cesium ion token for the 3D Moon. Add Cesium Moon (ion asset 2684829) to the token's account, or the viewer 404s |
| `VITE_API_URL`          | `web/.env` | Backend address. `/api` locally, the deployed API URL in production                                              |
| `API_PROXY_TARGET`      | shell      | Backend that Vite proxies `/api` to, when it is not `http://localhost:8000`                                      |
| `DATA_DIR`              | `api/.env` | Where NASA data and derived tables are stored. Keep it on a persistent volume when deployed                      |
| `SUPABASE_*`            | `api/.env` | Optional: sharing the horizon table and storing reservations                                                     |

Every `VITE_` value is public in the browser bundle. The Supabase service-role key belongs to the backend only. The full list of keys is in `web/.env.example` and `api/.env.example`.

Without NASA data, `cd web && npm run stub` serves synthetic responses on port 8000.

## Checks and tests

```sh
# Backend, from api/
uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest

# Frontend, from web/
npm run check   # lint, format check, typecheck, unit tests, build
npm run e2e     # Playwright
```

End-to-end tests are not run in CI. They need the backend with NASA data on port 8000 and the synthetic fixture API on port 8765 (`PORT=8765 npm run stub`); the first run also needs `npx playwright install chromium`. If those ports are taken, set `E2E_BASE_URL` and `API_PROXY_TARGET`:

```sh
E2E_BASE_URL=http://localhost:5174 API_PROXY_TARGET=http://localhost:8001 npm run e2e
```

## Data

Everything is computed from NASA data downloaded by `lunar_margin.pipeline.fetch`:

- **Terrain**: LRO LOLA south-pole DEM `ldem_80s_80m_float` (80 m/px, 80°S–90°S), from PDS Geosciences. It gives the terrain horizon seen from a site.
- **Supplementary terrain**: LOLA DEM `ldem_75s_120m_float` (120 m/px, 75°S–90°S). The 80 m DEM ends near 80°S, so horizon rays from sites at the edge of the search region would leave it. The two are combined into a composite DEM: 80 m values wherever they exist, 120 m values only outside them.
- **Sun and Earth positions**: NAIF SPICE kernels from NASA JPL (DE440s ephemeris, lunar orientation and frame kernels, leap seconds).

A candidate search also needs the terrain horizon of every search-grid site. `uv run python -m lunar_margin.pipeline.horizons` precomputes it into `DATA_DIR/horizons/` (about 210 MB, roughly 20 minutes on 12 cores). Horizons depend only on the site and the DEM, so later searches reuse them. `--upload` and `--download` share the table through a private Supabase Storage bucket, and the API downloads a missing table at startup when Supabase is configured.

Sources, versions and file lists are in [docs/data.md](docs/data.md) and [api/README.md](api/README.md).

## What the numbers mean

These are screening results for planning, not flight or safety certification.

- **Sunlight and Earth visibility**: a body counts as visible when its centre is above the terrain horizon in its direction. The Sun's angular radius is not included, and terrain smaller than the 80 m DEM resolves is not seen.
- **Communication**: Earth visibility is terrain clearance, not link quality. In a search with an RF scenario, the communication metrics follow a nominal RF link instead; ground stations, schedules, atmosphere and multipath are not modelled.
- **Terrain**: slope and roughness are the 95th percentile within 250 m of a site. They screen sites out; they do not certify that a site is safe to land on. A candidate's 500 m × 500 m footprint is a search-grid cell, not a claim that every point in it is landable.
- **Prices**: estimates from a planning model that uses public company rates where they exist. They are not bookable quotes.
- **Launch schedule**: public launch dates used as demo input, not a statement that a launch can carry the mission.
- **Trajectory**: a Lambert estimate refined by numerical Earth and Moon gravity shooting to a 100 km lunar perilune. It is not an ascent model or a Δv optimization, and it leaves out solar gravity, nonspherical gravity and finite burns.
- **Reservations**: a public demo without login. Without a configured database, reservations are disabled and everything else keeps working.

## Project layout

```
web/                   Vite app (React, TypeScript, Tailwind, CesiumJS)
  src/api/             API client and zod schemas, matching docs/api.md
  src/landing/         Stage 1: search form
  src/mission/         Date planner and the 3D Explore panels
  src/search/          Site selection panel and candidate search
  src/analysis/        Detailed point analysis
  src/moon/            Shared Cesium Moon viewer, markers, sunlight, equipment
  e2e/                 Playwright scenarios
api/                   uv project (FastAPI, Python 3.14)
  src/lunar_margin/
    app/               FastAPI app, routes, settings
    engine/            Pure calculations: SPICE, horizons, illumination, communication
    pipeline/          NASA data download and conversion, candidate search
  tests/
docs/                  API contract, datasets and feature notes
supabase/              Database migrations for reservations
```

A few choices that are easy to miss in the code:

- The Cesium viewer and camera live outside React state. React renders the panels only, and every screen mounts the one shared Moon viewer.
- Candidate footprints are classified onto the Moon tiles through explicit lunar height volumes (−20 km to +20 km). Cesium's ground primitives assume Earth's height range and clip high lunar ridges.
- Overlapping candidate markers are clustered into one badge. Clicking it zooms to its members without selecting a candidate or starting an analysis.
- Missing or failed results show empty and error states. Nothing falls back to example data.
- No DEM, SPICE kernel or terrain grid is bundled in the frontend or committed to git.

The frontend deploys to Vercel and the API to Railway (Dockerfile plus a volume for `DATA_DIR`). GitHub Actions runs the lint, format, type and test checks of both projects and the frontend build.

## Documentation

- [AGENTS.md](AGENTS.md): conventions, commands and workflow
- [docs/api.md](docs/api.md): API contract between frontend and backend
- [docs/data.md](docs/data.md): datasets and their sources
- [api/README.md](api/README.md): backend details, calculation method, assumptions and deployment
- [docs/candidates.md](docs/candidates.md): candidate search
- [docs/site-comparison.md](docs/site-comparison.md): candidate comparison
- [docs/provider-pricing.md](docs/provider-pricing.md): provider price model, sources and measured timings
- [docs/launch-schedule.md](docs/launch-schedule.md): launch schedule integration and assumptions
- [docs/reservations.md](docs/reservations.md): landing grid reservations, policy and setup
- [docs/descent-reference.md](docs/descent-reference.md) and [docs/doi-pdi-handoff.md](docs/doi-pdi-handoff.md): descent and landing flight model

## License

[MIT](LICENSE)
