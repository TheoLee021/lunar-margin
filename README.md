# Lunar Margin

A mission decision tool for comparing and evaluating landing sites and landing times near the lunar south pole.

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

See [AGENTS.md](AGENTS.md) for conventions, commands, and ownership.

## License

[MIT](LICENSE)

## Lunar viewer preview

The React HUD keeps explicitly labeled example candidate locations and rankings. Selected-site metrics and the mission timeline use the real analysis API; candidate ranks are not computed recommendations. `MissionSelection` is the shared map/panel selection; the Cesium viewer and camera stay outside React state and are destroyed on unmount.

Set `VITE_CESIUM_ION_TOKEN` in `web/.env.local` and add Cesium Moon (ion asset 2684829) to the token's account. Without a token, the app reports the missing configuration and keeps the basic Moon surface and example candidates usable. Workers and assets are copied from the installed Cesium package by `postinstall`; generated files are ignored by Git. No DEM, SPICE kernels, or terrain grids are bundled.

For local checks while another project occupies port 5173, use `E2E_BASE_URL=http://localhost:5174 API_PROXY_TARGET=http://localhost:8001 npm run e2e` from `web/`, with the API running on port 8001.

## Mission date planner

Click the mission dates to open the HUD-style planner. Its 5×5 price grid covers each reference departure/landing date ±2 days. Choosing a cell updates the example transfer path; applying commits departure, landing and duration to the shared selection. Closing or pressing Escape discards the draft, including duration. Dates and the applied schedule are validated with zod.

Costs, flight paths and landing-date scores remain explicitly illustrative fixtures. Site ranking and slope filters still operate on example data.

The selected-site panel and unified timeline request `/analysis/illumination` and `/analysis/earth-visibility` from the backend added in #5. Both responses must match the selected coordinates and the surface interval: landing midnight UTC through landing + 7/14/28 days (end exclusive), with 30-minute samples and observer height 0 m. Departure changes do not change surface analysis. The HUD shows the applied schedule; the dialog previews its draft until Apply. Loading, errors and empty results do not fall back to fixtures.

The timeline uses server elevations/visibility and exact server windows, with the terrain horizon interpolated at each body's azimuth. There is no extra 2° communication margin. Earth visibility describes terrain clearance, not a radio link budget. All samples remain available to the cursor and plot (at most 1,344 for 28 days).

Run a backend containing #5 and the SPICE concurrency fix before exercising this frontend. Download NASA data once from `api/` with `uv run python -m lunar_margin.pipeline.fetch`; DEM and kernels stay outside the frontend and Git. `API_PROXY_TARGET` selects the local API; `VITE_API_URL` selects the deployed API. The API client, response schema and shared analysis helpers are reused from #6 without replacing its analysis page.
