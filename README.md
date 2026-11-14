# Lunar Margin

A mission decision tool for comparing and evaluating landing sites and landing times near the lunar south pole.

## NASA data

The analysis is computed from NASA data that `cd api && uv run python -m lunar_margin.pipeline.fetch` downloads (about 501 MB; never committed to git):

- **Terrain**: LRO LOLA south-pole DEM `ldem_80s_80m_float` (80 m/px, 80°S–90°S) from PDS Geosciences. Used to compute the terrain horizon seen from a site.
- **Terrain, supplementary**: LOLA DEM `ldem_75s_120m_float` (120 m/px, 75°S–90°S, 232 MB).
  The 80 m DEM ends at about 80°S, so for sites near the edge of the search region (85°S) the horizon rays toward the far side would leave the data.
  The two are combined as a _composite DEM_: the 80 m values are used wherever they exist, and the 120 m values only fill in outside them (or where a pixel is missing).
  Both use the same polar stereographic projection, so they overlay directly. The 120 m grid is coarser, so features smaller than about 120 m are not resolved there;
  that only affects distant terrain.
- **Sun and Earth positions**: NAIF SPICE kernels (DE440s ephemeris, lunar orientation and frame kernels, leap seconds) from NASA JPL. Used to compute where the Sun and Earth are in the lunar sky over time.

A body counts as visible when its elevation is above the terrain horizon in its direction.

Derived data (generated locally, not downloaded, not in git): `uv run python -m lunar_margin.pipeline.horizons` precomputes the terrain horizon of every search-grid site into `DATA_DIR/horizons/` (about 210 MB, roughly 20 minutes on 12 cores).
Horizons depend only on the site and the DEM, not on dates or mission limits, so later searches read them instead of recomputing.

Sources, versions, and file list: [docs/data.md](docs/data.md) and [api/README.md](api/README.md).

## Quick start

```sh
# Backend (Docker)
docker compose up --build

# Backend (local development, Python 3.14 + uv)
cd api
uv sync
cp .env.example .env
uv run fastapi dev src/lunar_margin/app/main.py

# Frontend (Node 24)
cd web
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173.

Backend details (NASA data ingestion, illumination and Earth-visibility analysis): see [api/README.md](api/README.md).

Analysis UI (illumination / Earth visibility detail view): with the backend running and data fetched (`cd api && uv run python -m lunar_margin.pipeline.fetch`), open `/?view=analysis` (or choose 상세 분석 from the HUD) and pick a site. Without NASA data, `cd web && npm run stub` serves synthetic responses on :8000. `npm run e2e` runs against the real backend with NASA data (start the API first).

See [AGENTS.md](AGENTS.md) for conventions, commands, and ownership.

## License

[MIT](LICENSE)

## Lunar viewer preview

The React HUD keeps explicitly labeled example candidate locations and rankings. Selected-site metrics and the mission timeline use the real analysis API; candidate ranks are not computed recommendations. `MissionSelection` is the shared map/panel selection; the Cesium viewer and camera stay outside React state and are destroyed on unmount.

Set `VITE_CESIUM_ION_TOKEN` in `web/.env.local` and add Cesium Moon (ion asset 2684829) to the token's account. The HUD adapts the shared `web/src/moon/MoonViewer.tsx` from #9 through marker props and its camera handle. Without a token, the shared viewer reports a configuration error. Workers and assets are served by the existing `vite-plugin-static-copy` configuration; no second viewer or install-time copying is used. No DEM, SPICE kernels, or terrain grids are bundled.

For local checks while another project occupies port 5173, use `E2E_BASE_URL=http://localhost:5174 API_PROXY_TARGET=http://localhost:8001 npm run e2e` from `web/`, with the API running on port 8001.

The default `/` screen is the mission HUD. `/?view=analysis` preserves the existing detailed analysis workspace, including Moon surface picking, presets, thresholds and comparison. The navigation links switch between these screens; each mounts one shared Moon viewer.

## Mission date planner

Click the mission dates to open the HUD-style planner. Its 5×5 price grid covers each reference departure/landing date ±2 days. Choosing a cell updates the example transfer path; applying commits departure, landing and duration to the shared selection. Closing or pressing Escape discards the draft, including duration. Dates and the applied schedule are validated with zod.

Costs, flight paths and landing-date scores remain explicitly illustrative fixtures. Site ranking and slope filters still operate on example data.

The selected-site panel and unified timeline request `/analysis/illumination` and `/analysis/earth-visibility` from the backend added in #5. Both responses must match the selected coordinates and the surface interval: landing midnight UTC through landing + 7/14/28 days (end exclusive), with 30-minute samples and observer height 0 m. Departure changes do not change surface analysis. The HUD shows the applied schedule; the dialog previews its draft until Apply. Loading, errors and empty results do not fall back to fixtures.

The timeline uses server elevations/visibility and exact server windows, with the terrain horizon interpolated at each body's azimuth. There is no extra 2° communication margin. Earth visibility describes terrain clearance, not a radio link budget. All samples remain available to the cursor and plot (at most 1,344 for 28 days).

Run a backend containing #5 and the SPICE concurrency fix before exercising this frontend. Download NASA data once from `api/` with `uv run python -m lunar_margin.pipeline.fetch`; DEM and kernels stay outside the frontend and Git. `API_PROXY_TARGET` selects the local API; `VITE_API_URL` selects the deployed API. The API client, response schema and shared analysis helpers are reused from #6 without replacing its analysis page.
