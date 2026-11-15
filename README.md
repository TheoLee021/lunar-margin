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
When those variables are set and the table is missing, the API server downloads it in a background thread at startup (it does not wait; set `HORIZON_TABLE_DOWNLOAD_ON_START=false` to disable). In a deployment keep `DATA_DIR` on a persistent volume so it is not downloaded on every deploy.

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

The date planner contains date selection, mission conditions, the average-price grid and an illustrative landing-date score chart, with no surface-analysis or trajectory request. The mission timeline sits below the selected candidate’s metrics on the main dashboard and shares their analysis result. “이 일정의 궤도 보기” keeps the selected draft as the shared schedule and navigates in the same app to `/orbit`. The dedicated page provides the two large plots, date inputs and playback. Editing valid dates there updates the shared schedule; “날짜 계획으로 돌아가기” reopens the planner with those dates and the same site/duration. Browser Back/Forward and reload retain the selection through validated `departure`, `arrival`, `duration`, and `site` URL parameters. Closing a planner draft without applying or opening the orbit page still discards that draft. The old `?view=orbit` link remains compatible and is normalized to `/orbit`. Vercel serves `/orbit` through the SPA entry point using `web/vercel.json`. No routing library or storage service is added.

Prices use the eligible-grid model described below. The dashboard reads the completed 500m search for the selected landing date and duration and shows its first five ranked candidates. A matching run in `run` or `pricing_run` is preferred; otherwise the newest matching saved result is used. Applied search conditions replace the former example filters. No candidate is selected by default, and no point analysis is requested until a candidate is selected. Missing results show an empty state and search link, never example candidates. The orbit preview calls `GET /trajectory/transfer` when the selected departure or arrival date changes (both dates mean 00:00 UTC). It uses DE440 geometric Moon states, a Lambert initial estimate and numerical Earth/Moon gravity shooting to reach a lunar perilune at 100 km altitude at the requested arrival time. The parking orbit is 200 km with a freely chosen plane/orientation; this is not a Cape Canaveral ascent model or a minimum-Δv optimization. The solver adjusts departure velocity and the arrival-point angle together, requiring zero lunar radial speed and positive radial acceleration at arrival. LOI reduces tangential speed to local circular speed without turning the trajectory, then the model propagates another 14 hours. Solar gravity, nonspherical gravity, finite burns and landing are excluded.

Supported inputs: years 1900–2100 and flight times 1–10 days. The solver rejects non-convergence, Earth approaches below 100 km, lunar collisions and arrival position residuals above 50 m or lunar radial speed above 0.01 m/s. The residual measures internal numerical targeting, not independent flight-navigation accuracy. SPICE states are interpolated with a 30-minute cubic Hermite grid for propagation. The last and first 10 minutes around LOI include 5-second samples to resolve the tangent connection. The response supplies 3D J2000 positions in km and elapsed seconds from departure. The left plot projects to J2000 XY; the right plot projects to the incoming lunar orbital plane so the lunar body and capture orbit can be compared. Both plots keep equal axis scales, show units and legends, and stack on mobile.

Requests are debounced and cancelled when dates change; the old path disappears immediately while the new one is computing. Responses must match the requested dates and pass zod validation. Missing data, unsupported dates, busy solvers and failed calculations show errors and a retry action, with no static-trajectory fallback. The API allows two simultaneous solves with a 20-second budget each. The original [jaehyeon research experiment](https://github.com/TheoLee021/lunar-margin/tree/jaehyeon/research/earth_moon_transfer) remains a separate reference; the live preview does not load precomputed trajectory assets.

Run the backend from this checkout with SciPy installed by `cd api && uv sync`, NASA kernels prepared by `uv run python -m lunar_margin.pipeline.fetch`, and `DATA_DIR` pointing to the downloaded data when using another location. Set `API_PROXY_TARGET` to that backend when starting Vite. The new trajectory endpoint only needs SPICE files, not a DEM. See `docs/api.md` for the request/response contract.

Dashboard candidates use their saved polar-grid coordinates and spacing to draw 500m × 500m footprints on the Moon tiles. Selecting a footprint highlights it and opens the same candidate metrics and timeline as the list. “선택 지점 3D로 보기” zooms to the terrain surface so the actual cell boundary is visible. The footprint represents the search grid, not certification that every point in it is landable.

The fill and border classify the actual Moon tiles through explicit lunar height volumes (−20km to +20km). They avoid Cesium ground primitives’ Earth-specific approximate height table, which can clip high lunar ridges. These are invisible render volumes, not altitude measurements or raised boxes. Marker updates and viewer teardown release their primitives.

Overlapping candidate labels are grouped by Cesium screen-space clustering into a “후보 N개” badge. Clicking the badge zooms to its members without changing the selected candidate or starting an analysis. Zooming in separates individual labels and grid footprints; zooming out groups them again. Clicking a TOP 5 list row, individual map number or footprint selects that candidate, updates its timeline, and zooms to its grid using the same view as “선택 지점 3D로 보기”. Clicking the same list row again also refocuses the camera. The badge counts only the displayed TOP 5, not every eligible grid in the saved run.

The selected-site panel and unified timeline request `/analysis/illumination` and `/analysis/earth-visibility` from the backend added in #5. Both responses must match the selected coordinates and the surface interval: landing midnight UTC through landing + 7/14/28 days (end exclusive), with 30-minute samples and the saved search’s observer height. Departure changes do not change surface analysis. The HUD metrics and timeline show the selected candidate and applied schedule. Draft date edits update the timeline only after Apply. Loading, errors and empty results do not fall back to fixtures.

The timeline uses server elevations/visibility and exact server windows, with the terrain horizon interpolated at each body's azimuth. There is no extra 2° communication margin. Earth visibility describes terrain clearance, not a radio link budget. All samples remain available to the cursor and plot (at most 1,344 for 28 days).

Run a backend containing #5 and the SPICE concurrency fix before exercising this frontend. Download NASA data once from `api/` with `uv run python -m lunar_margin.pipeline.fetch`; DEM and kernels stay outside the frontend and Git. `API_PROXY_TARGET` selects the local API; `VITE_API_URL` selects the deployed API. The API client, response schema and shared analysis helpers are reused from #6 without replacing its analysis page.

Candidate search UI: choose **후보지 탐색**, enter a mission, and optionally enable the development search (20 km → 10 km). Requires the candidate search backend. See [docs/candidates.md](docs/candidates.md).


## Candidate-search terrain slope

Candidate search now enforces the optional maximum terrain slope in both standard
and development searches. It uses the 250 m regional DEM slope P95
(160 m slope baseline, 400 m roughness window). Incomplete
regional terrain cannot pass. The table and candidate detail show measured slopes;
the filter step explains slope and terrain-coverage exclusions. Historical runs
remain readable and are labeled as not applying slope. Start a new search to apply
the limit; old results are not reused by the new mission cache version.
This is terrain screening, not certified landing safety.

## Provider prices from the 500m candidate search

The date planner compares six companies using a planning model. Public company
rates take priority; missing rates use the existing delivery-mode reference tariff,
with the modeled $500,000 fixed fee when no fee is published. The UI distinguishes
public-rate estimates from the common model and lists the assumptions. These are
not bookable company quotes. Each date combination averages each original eligible
500m grid's lowest estimated cost, before Top-K selection. Partial grid coverage
never becomes a full-grid mean.

Choose a lunar mission's tentative departure from Spaceflight Now and Space Launch
Schedule, then choose the landing date independently. Month-only or conflicting
dates cannot be auto-selected. Source precision, update time and stale fallback
are visible. Clicking a completed date opens its saved candidate search and carries
departure, landing, duration, mass and delivery mode. Details display all six companies.
The strict public-quote API remains available separately and never fills unknown
quotes with model estimates. See [schedule integration and assumptions](docs/launch-schedule.md).

There is no Top-100 shortcut or company-specific terrain recomputation. The
calendar assesses mission terms first, reads each landing date’s terrain once only
when a comparable estimate exists, and compares provider costs with vector
operations. Saved runs selected as the mission template are reused across search
hash versions only while their mission conditions match. Missing dates still start
one batch through `POST /pricing/calculate`; completed dates are excluded.

See [provider sources, rules and measured timings](docs/provider-pricing.md) and
[API contracts](docs/api.md). Local synthetic price comparison of six qualified
providers × 142,642 unchanged grids × five dates took 0.004–0.006 seconds. This
measures pricing after terrain analysis, not a new NASA search. The batch search
continues to require its matching precomputed horizon table.

## 착륙 격자 예약

500m 격자 예약·충돌 판정·후보지 예약 가능 순위를 지원합니다. [정책과 로컬/Supabase 설정](docs/reservations.md)을 참고하세요. DB가 설정되지 않으면 예약만 비활성화되며 기존 분석은 계속 사용할 수 있습니다.

출발일은 날짜 계획의 **발사 일정에서 출발일 선택**에서 Spaceflight Now와
Space Launch Schedule의 달 임무 예정일을 고를 수 있습니다. 착륙일은 별도로 직접
선택합니다. 가격은 공개 단가 우선, 미공개 시 기존 공통 모델을 사용하는 **예상 비용**이며
실제 견적·운항 가능성을 뜻하지 않습니다. [연결 범위와 계산 가정](docs/launch-schedule.md).
