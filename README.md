# Lunar Margin

A mission decision tool for comparing and evaluating landing sites and landing times near the lunar south pole.

## NASA data

The analysis is computed from two NASA datasets (about 269 MB, downloaded by `cd api && uv run python -m lunar_margin.pipeline.fetch`, never committed to git):

- **Terrain**: LRO LOLA south-pole DEM (`ldem_80s_80m_float`, 80 m/px, 80°S–90°S) from PDS Geosciences. Used to compute the terrain horizon seen from a site.
- **Sun and Earth positions**: NAIF SPICE kernels (DE440s ephemeris, lunar orientation and frame kernels, leap seconds) from NASA JPL. Used to compute where the Sun and Earth are in the lunar sky over time.

A body counts as visible when its elevation is above the terrain horizon in its direction. Sources, versions, and file list: [docs/data.md](docs/data.md) and [api/README.md](api/README.md).

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

The React HUD uses explicitly labeled example candidates and mission metrics. These are UI fixtures, not computed recommendations. `MissionSelection` is the shared map/panel selection; the Cesium viewer and camera stay outside React state and are destroyed on unmount.

Set `VITE_CESIUM_ION_TOKEN` in `web/.env.local` and add Cesium Moon (ion asset 2684829) to the token's account. The HUD adapts the shared `web/src/moon/MoonViewer.tsx` from #9 through marker props and its camera handle. Without a token, the shared viewer reports a configuration error. Workers and assets are served by the existing `vite-plugin-static-copy` configuration; no second viewer or install-time copying is used. No DEM, SPICE kernels, or terrain grids are bundled.

For local checks while another project occupies port 5173, use `E2E_BASE_URL=http://localhost:5174 API_PROXY_TARGET=http://localhost:8001 npm run e2e` from `web/`, with the API running on port 8001.

The default `/` screen is the mission HUD. `/?view=analysis` preserves the existing detailed analysis workspace, including Moon surface picking, presets, thresholds and comparison. The navigation links switch between these screens; each mounts one shared Moon viewer.
