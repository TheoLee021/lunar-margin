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
To share a table instead of recomputing it on every machine, `pipeline.horizons --upload` puts it in a private Supabase Storage bucket (split into 32 MiB parts with a sha256 manifest) and `pipeline.horizons --download` fetches and verifies it. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_BUCKET` in `api/.env`; the service-role key stays on the backend or a local script, never in the frontend.

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

## Mission date planner and flight orbit page

Click the mission dates to open the HUD-style planner. Its 5×5 price grid covers each reference departure/landing date ±2 days. Choosing a cell updates the draft dates; applying commits departure, landing and duration to the shared selection. Closing or pressing Escape discards the draft, including duration. Dates and the applied schedule are validated with zod.

The date planner contains the date grid, surface mission duration and surface-analysis charts, with no trajectory plot or trajectory request. “이 일정의 궤도 보기” keeps the selected draft as the shared schedule and navigates in the same app to `/orbit`. The dedicated page provides the two large plots, date inputs and playback. Editing valid dates there updates the shared schedule; “날짜 계획으로 돌아가기” reopens the planner with those dates and the same site/duration. Browser Back/Forward and reload retain the selection through validated `departure`, `arrival`, `duration`, and `site` URL parameters. Closing a planner draft without applying or opening the orbit page still discards that draft. The old `?view=orbit` link remains compatible and is normalized to `/orbit`. Vercel serves `/orbit` through the SPA entry point using `web/vercel.json`. No routing library or storage service is added.

Costs and landing-date scores remain explicitly illustrative fixtures. Site ranking and slope filters still operate on example data. The orbit preview calls `GET /trajectory/transfer` when the selected departure or arrival date changes (both dates mean 00:00 UTC). It uses DE440 geometric Moon states, a Lambert initial estimate and numerical Earth/Moon gravity shooting to reach a lunar perilune at 100 km altitude at the requested arrival time. The parking orbit is 200 km with a freely chosen plane/orientation; this is not a Cape Canaveral ascent model or a minimum-Δv optimization. The solver adjusts departure velocity and the arrival-point angle together, requiring zero lunar radial speed and positive radial acceleration at arrival. LOI reduces tangential speed to local circular speed without turning the trajectory, then the model propagates another 14 hours. Solar gravity, nonspherical gravity, finite burns and landing are excluded.

Supported inputs: years 1900–2100 and flight times 1–10 days. The solver rejects non-convergence, Earth approaches below 100 km, lunar collisions and arrival position residuals above 50 m or lunar radial speed above 0.01 m/s. The residual measures internal numerical targeting, not independent flight-navigation accuracy. SPICE states are interpolated with a 30-minute cubic Hermite grid for propagation. The last and first 10 minutes around LOI include 5-second samples to resolve the tangent connection. The response supplies 3D J2000 positions in km and elapsed seconds from departure. The left plot projects to J2000 XY; the right plot projects to the incoming lunar orbital plane so the lunar body and capture orbit can be compared. Both plots keep equal axis scales, show units and legends, and stack on mobile.

Requests are debounced and cancelled when dates change; the old path disappears immediately while the new one is computing. Responses must match the requested dates and pass zod validation. Missing data, unsupported dates, busy solvers and failed calculations show errors and a retry action, with no static-trajectory fallback. The API allows two simultaneous solves with a 20-second budget each. The original [jaehyeon research experiment](https://github.com/TheoLee021/lunar-margin/tree/jaehyeon/research/earth_moon_transfer) remains a separate reference; the live preview does not load precomputed trajectory assets.

Run the backend from this checkout with SciPy installed by `cd api && uv sync`, NASA kernels prepared by `uv run python -m lunar_margin.pipeline.fetch`, and `DATA_DIR` pointing to the downloaded data when using another location. Set `API_PROXY_TARGET` to that backend when starting Vite. The new trajectory endpoint only needs SPICE files, not a DEM. See `docs/api.md` for the request/response contract.

The selected-site panel and unified timeline request `/analysis/illumination` and `/analysis/earth-visibility` from the backend added in #5. Both responses must match the selected coordinates and the surface interval: landing midnight UTC through landing + 7/14/28 days (end exclusive), with 30-minute samples and observer height 0 m. Departure changes do not change surface analysis. The HUD shows the applied schedule; the dialog previews its draft until Apply. Loading, errors and empty results do not fall back to fixtures.

The timeline uses server elevations/visibility and exact server windows, with the terrain horizon interpolated at each body's azimuth. There is no extra 2° communication margin. Earth visibility describes terrain clearance, not a radio link budget. All samples remain available to the cursor and plot (at most 1,344 for 28 days).

Run a backend containing #5 and the SPICE concurrency fix before exercising this frontend. Download NASA data once from `api/` with `uv run python -m lunar_margin.pipeline.fetch`; DEM and kernels stay outside the frontend and Git. `API_PROXY_TARGET` selects the local API; `VITE_API_URL` selects the deployed API. The API client, response schema and shared analysis helpers are reused from #6 without replacing its analysis page.
