# API 계약 (프론트 ↔ 백엔드)

변경 시 기존 응답을 깨지 않게 필드 추가 위주로 바꾼다.
백엔드 PR을 먼저 머지한 뒤 프론트 PR을 머지한다. 프론트의 zod 스키마(`web/src/api/`)와 백엔드 pydantic 모델은 이 문서와 일치해야 한다.

## 공통

- Base URL: 로컬 `/api` (Vite proxy → `http://localhost:8000`), 배포 `VITE_API_URL` (Railway)
- 시간: UTC ISO 8601 (`2027-01-15T12:00:00Z`)
- 좌표: 달 planetocentric 위도(남쪽 음수, 도), 동경 양수 경도(도, 0~360 또는 -180~180 입력 허용). 방위각 0°=북, 시계방향(동쪽 90°). 기준 구 반경 1737.4 km
  - 프레임: MOON_ME (백엔드 SPICE·LOLA DEM과 같음). 벡터(태양 방향 등)는 MOON_ME 직교좌표이며, 프론트는 Cesium 월드 좌표를 MOON_ME로 취급하고 변환하지 않는다
- 에러: FastAPI 기본 `{"detail": ...}`

## Endpoints

### `GET /health`

```json
{ "status": "ok" }
```

### `GET /analysis/illumination`, `GET /analysis/earth-visibility`

지형 수평선 대비 태양(`illumination`) 또는 지구(`earth-visibility`) 가시성을 계산한다. 두 엔드포인트의 응답 형태는 같다.

쿼리: `lat` (-90~-80), `lon`, `start`, `end` (타임존 포함 UTC ISO 8601, `end > start`, 최대 3년), `step_minutes` (기본 30, 5~360), `observer_height_m` (기본 0, 0~100). 잘못된 입력은 422.

```json
{
  "lat": -89.7, "lon": 130.0,
  "start": "2027-01-01T00:00:00Z", "end": "2027-02-01T00:00:00Z", "step_minutes": 30,
  "observer_height_m": 0,
  "metrics": {
    "visible_fraction": 0.42,
    "longest_dark_hours": 96.5,
    "windows_per_24h": 0.9,
    "mean_elevation_deg": 0.8
  },
  "horizon": { "azimuth_deg": [0, 1, 2], "elevation_deg": [1.2, 1.3, 1.1] },
  "series": {
    "times": ["2027-01-01T00:00:00Z"],
    "body_azimuth_deg": [212.4],
    "body_elevation_deg": [0.7],
    "visible": [true]
  },
  "windows": [{ "start": "2027-01-01T00:00:00Z", "end": "2027-01-01T11:30:00Z" }],
  "dark_periods": [{ "start": "2027-01-01T11:30:00Z", "end": "2027-01-04T12:00:00Z" }]
}
```

- `metrics`: illumination은 평균 일조율, 최장 연속 암흑 시간, 24시간당 일조 창 횟수. earth-visibility는 평균 지구 가시율, 최장 통신 두절 시간, 가시 구간 평균 지구 고도각 (`mean_elevation_deg`는 가시 구간이 없으면 `null`).
- `horizon`: 방위각별 지형 수평선 고각(도). 관측점 기준.
- `series`: 시간 배열과 같은 길이의 배열들. `visible` = `body_elevation_deg > horizon(body_azimuth_deg)`.
- `windows`, `dark_periods`: `visible` 연속 구간(`end` 미포함). 기간 경계에서 잘린 구간도 포함.

### `GET /analysis/site-assessment`

여러 후보 지점을 같은 기간으로 비교할 때 쓰는 요약. 쿼리는 위 두 엔드포인트와 같다. 시계열·수평선 없이 지표와 지형만 돌려준다.

```json
{
  "lat": -89.7, "lon": 130.0,
  "start": "2027-01-01T00:00:00Z", "end": "2027-02-01T00:00:00Z", "step_minutes": 30,
  "observer_height_m": 0,
  "sun": { "visible_fraction": 0.42, "longest_dark_hours": 96.5, "windows_per_24h": 0.9, "mean_elevation_deg": 0.8 },
  "earth": { "visible_fraction": 0.88, "longest_dark_hours": 40.0, "windows_per_24h": 0.07, "mean_elevation_deg": 4.1 },
  "terrain": {
    "slope_p95_deg": 6.1, "coverage_fraction": 1.0,
    "assessment_radius_m": 250, "slope_baseline_m": 160, "roughness_window_m": 400,
    "dem_pixel_m": 80, "landing_safety_status": "UNVERIFIED"
  }
}
```

- `sun`, `earth`: 같은 쿼리로 `illumination`, `earth-visibility`를 부른 응답의 `metrics`와 같은 값.
- `terrain`: 후보 탐색 결과의 `terrain`과 같은 형태·계산(후보 중심 250 m 원의 DEM 경사 P95, 80 m 주 DEM). 판정은 하지 않는다. DEM 결측으로 `coverage_fraction < 1`이어도 그대로 돌려주며, 결측을 통과로 해석하지 않는 것은 호출하는 쪽의 몫이다. `slope_p95_deg`는 유효 표본이 없으면 `null`.
- 지점이 DEM 밖이면 422.

## 후보지 탐색 결과 (`/candidates`)

남극 후보지 탐색은 오래 걸려서(수 분~십수 분) CLI(`python -m lunar_margin.pipeline.candidates`)가 한 번 돌려 `DATA_DIR/candidates/{run_id}/`에 결과를 쓰고, API는 그 결과를 읽어서 돌려준다. 화면은 이 결과로 **탐색 과정**(거친 격자 -> 세밀화 -> 필터 -> 연결 영역 -> 선정)을 단계별로 재생한다. 설계는 `docs/candidates.md`.

`run_id`는 `^[A-Za-z0-9_-]{1,64}$`. 없는 실행은 404, 형식이 틀리면 422.

### `GET /candidates/runs`

```json
{ "runs": [ {
  "id": "default", "generated_at": "2026-11-14T20:01:12+00:00", "dem": "80s_80m",
  "window": { "start": "2027-01-01T00:00:00+00:00", "end": "2046-01-01T00:00:00+00:00", "step_minutes": 60 },
  "selected": 100, "sampled_total": 183210
} ] }
```

실행이 하나도 없으면 `{"runs": []}` (빈 상태).

### `GET /candidates/runs/{run_id}`

```json
{
  "id": "default",
  "source": { "dem": {"name": "80s_80m", "file": "ldem_80s_80m_float.img", "sha256": "...", "resolution_m": 80.0},
              "spice_kernels": [{"name": "de440s.bsp", "sha256": "..."}],
              "window": {"start": "...", "end": "...", "step_minutes": 60},
              "projection": "polar stereographic, scale 1 at the south pole, ...", "plan_id": "south_polar_dense" },
  "config": { "...": "SearchConfig 전체 (roi, grid_spacing_m, coarse_spacing_m, refine_fraction, min_separation_m, top_k, thresholds, weights, window, dem ...)" },
  "summary": {
    "counts": { "coarse_sampled": 18073, "promoted_coarse": 2100, "refined": 61000, "coarse_only": 15973,
                "sampled_total": 76973, "computed": 76973, "missing_all_metrics": 0,
                "eligible": 76973, "excluded": 0, "unevaluated": 0, "horizon_incomplete": 40000,
                "regions": 12, "in_regions": 58000, "selected": 100 },
    "reasons": { "sun_fraction_below_min": 0, "not_refined": 15900, "within_min_separation": 3000, "beyond_top_k": 500 },
    "distributions": { "sun_fraction": {"min": 0.0, "p10": 0.0, "p25": 0.1, "p50": 0.3, "p75": 0.4, "p90": 0.45, "max": 0.6},
                       "earth_fraction": {"...": 0}, "sun_longest_dark_h": {"...": 0}, "earth_longest_blackout_h": {"...": 0} },
    "warnings": ["격자 간격 500 m는 DEM 해상도 80 m의 6.25배로 더 거칩니다. ..."]
  },
  "run": { "generated_at": "...", "elapsed_seconds": 812.4, "workers": 14 },
  "map": { "size_px": 607, "center_px": 303, "pixel_size_m": 500.0, "rho_max_m": 151712.3,
           "layers": ["coarse_sun", "coarse_earth", "coarse_promoted", "sun", "earth", "stage",
                      "eligibility", "regions", "quality"] },
  "candidates": [ {
    "id": "SP500_+12_-30", "rank": 1, "lat_deg": -89.31, "lon_deg": 222.4, "x_m": 6000.0, "y_m": -15000.0, "grid_spacing_m": 500.0,
    "sun": {"fraction": 0.61, "longest_dark_hours": 210.0, "windows_per_24h": 0.04, "mean_elevation_deg": 0.7},
    "earth": {"fraction": 0.52, "longest_blackout_hours": 190.0, "windows_per_24h": 0.04, "mean_elevation_deg": 3.1},
    "eligibility": {"status": "eligible", "failed": [], "not_applied": []},
    "score": {"total": 0.565, "sun_component": 0.61, "earth_component": 0.52, "components_used": 2},
    "region_id": 3,
    "data_quality": {"horizon_complete": true, "horizon_max_deg": 2.4, "missing_metrics": [], "stage": "fine"},
    "selection": {"picked_as": "region_best", "note": ""}
  } ]
}
```

- 지표 값이 계산되지 않은 곳은 `null` (0이 아니다). `eligibility.status`는 `eligible | excluded | unevaluated`.
- `candidates`는 순위순이고 최대 `config.top_k`개. 선정이 하나도 없으면 빈 배열.
- `summary.counts.in_regions`는 연결 영역에 속한 세밀 점의 개수(적격한 점)다.
- `summary.counts`로 단계별 개수(퍼널), `summary.reasons`로 탈락 사유별 개수를 그린다. `reasons` 키: 위반한 조건(`sun_fraction_below_min`, `sun_dark_hours_above_max`, `earth_fraction_below_min`, `earth_blackout_hours_above_max`, `horizon_incomplete`), `no_metrics`, `not_refined`, `within_min_separation`, `beyond_top_k`.
- `summary.warnings`는 사용자에게 그대로 보여준다.

### `GET /candidates/runs/{run_id}/layers/{name}.png`

`name`은 위 `map.layers` 중 하나. 모두 `size_px` x `size_px` RGBA PNG이고 결측·해당 없음은 투명이다. **격자 한 칸이 한 픽셀**이며 `image-rendering: pixelated`로 확대해서 쓴다.
픽셀 `(col, row)`의 투영 좌표는 `x_m = (col - center_px) * pixel_size_m`, `y_m = (center_px - row) * pixel_size_m` (경도 0°가 위쪽, 동쪽이 오른쪽). 거친 점은 간격만큼의 블록으로 칠해진다.

| name | 단계 | 내용 |
| --- | --- | --- |
| `coarse_sun`, `coarse_earth` | 1. 거친 격자 | 거친 격자(2 km)의 일조율·지구 가시율 (0 보라 -> 1 노랑) |
| `coarse_promoted` | 2. 세밀화 영역 | 세밀화 대상으로 고른 거친 점 (주황, 나머지 투명) |
| `sun`, `earth` | 3. 세밀 결과 | 최종 일조율·지구 가시율 (세밀 점 + 세밀화 안 된 거친 점) |
| `stage` | 3 | 세밀 점(청록) / 거친 점만(회청) |
| `eligibility` | 4. 필터 | 적격(초록) / 제외(빨강) / 판정 불가(회색) |
| `regions` | 5. 연결 영역 | 적격 점의 연결 영역마다 다른 색 |
| `quality` | 품질 | 수평선이 DEM 밖으로 나간 점(주황) |

선정 후보(6단계)는 레이어가 아니라 `candidates`의 `x_m`, `y_m`으로 지도 위에 그린다.

`x_m`, `y_m` -> 위경도 변환식(프론트에서 필요하면): `rho = hypot(x, y)`, `lat = -90 + degrees(2*atan(rho / (2*1737400)))`, `lon = degrees(atan2(x, y)) mod 360`.
임의의 점을 눌러 자세히 보려면 위 변환으로 위경도를 구해 `GET /analysis/illumination`, `GET /analysis/earth-visibility`를 호출하면 된다 (그 API는 한 번에 3년·10만 표본까지라서, `config.window.start`부터 1년을 쓴다).

### `POST /candidates/search` (임무 입력으로 탐색 시작)

사용자의 임무 조건을 받아 탐색을 **별도 프로세스로** 시작한다(수 분 걸림). 같은 입력은 같은 `run_id`를 갖고, 이미 끝난 결과가 있으면 다시 계산하지 않는다.

요청 본문 (`MissionRequest`, 모르는 필드는 422):

```json
{
  "landing_date": "2027-01-01",
  "mission_duration_days": 14,
  "max_continuous_darkness_hours": 24,
  "max_communication_blackout_hours": 6,
  "max_terrain_slope_degrees": 10,
  "search_region": "south",
  "optimization_priority": "balanced",
  "observer_height_m": null
}
```

| 필드 | 설명 |
| --- | --- |
| `landing_date` | `YYYY-MM-DD` (UTC). 1850~2150 안. **착륙 날짜 + 임무 기간이 곧 분석 기간**이다 (`landing_date` 00:00 UTC ~ 임무 기간 뒤, 끝 미포함) |
| `mission_duration_days` | 1~365 (지구일) |
| `max_continuous_darkness_hours` | 임무 기간 중 직사광이 없는 최장 연속 시간 한도. `null`이면 조건 없음. 0 이상 |
| `max_communication_blackout_hours` | 지구가 보이지 않는 최장 연속 시간(통신 두절) 한도. `null`이면 조건 없음. 0 이상 |
| `max_terrain_slope_degrees` | 0 초과 90 이하 또는 `null`. 후보 중심 250 m 반경의 DEM 경사 P95에 적용(160 m 경사 기준, 400 m 거칠기 창). 유효 지형 표본 100%와 P95 ≤ 한도를 모두 만족해야 통과. `null`이면 지형 필터를 적용하지 않는다 |
| `search_region` | `"south"`만 가능. `"global"`은 422 ("hybrid global search is planned and not available yet") |
| `optimization_priority` | `"balanced"`(일조 40%, 통신 40%, 가시권 20%), `"solar"`(60%, 20%, 20%), `"earth"`(20%, 60%, 20%), `"visibility"`(일조 25%, 통신 25%, 주변 가시권 50%). 주변 가시권은 임무 관측 높이에서 반경 5 km 안의 800 m 간격 격자점 120개 중 보이는 비율이다. 거친 격자와 정밀 격자 점수에 모두 반영하며 선정 결과의 `score.visible_grid_points`에 개수를 기록한다. 자료가 불완전하면 이 성분은 제외한다. 점수 가중치이며 적격 여부와는 별개 |
| `observer_height_m` | 0~100 또는 `null`(= 0, 지표면) |

두 한도는 **필수 적격 조건**이라 넘는 지점은 후보에서 빠진다(`summary.reasons`에 사유별 개수). 두 한도가 모두 `null`이면 필터 없이 점수 순위만으로 뽑는다.

응답:

```json
{ "run_id": "m-3f9a1c0b2d", "state": "queued", "cached": false }
```

| 상태 코드 | 의미 |
| --- | --- |
| 202 | 새 탐색을 시작했다 (`state`: `queued`) |
| 200 | 이미 있다. `cached: true, state: "done"`이면 이전 결과를 그대로 쓴다. 같은 입력이 실행 중이면 `cached: false`와 현재 `state` |
| 409 | **다른 입력의 탐색이 이미 실행 중**이다. `{"detail": {"message": "...", "running_run_id": "m-..."}}`. 탐색은 한 번에 하나만 돈다. 10분 넘게 진행 상태가 갱신되지 않은 실행은 `failed`로 보고 막지 않는다 |
| 422 | 입력이 잘못됨 (범위 밖 값, 알 수 없는 필드, `search_region: "global"` 등) |
| 500 | 탐색 프로세스를 시작하지 못함 |

### `GET /candidates/runs/{run_id}/status`

```json
{ "run_id": "m-3f9a1c0b2d", "state": "running", "stage": "fine", "done": 41200, "total": 119037,
  "error": null, "started_at": "2026-11-14T21:03:10+00:00", "updated_at": "2026-11-14T21:05:02+00:00" }
```

- `state`: `queued | running | done | failed`. 화면은 `done`이 될 때까지 몇 초 간격으로 이 주소를 부르고(폴링), `done`이면 `GET /candidates/runs/{run_id}`로 결과를 읽어 과정 화면을 연다.
- `stage`: `queued`, `starting`, `coarse`(거친 격자), `fine`(세밀 격자), `writing`(결과 쓰는 중), `done`. `done`/`total`은 **그 단계 안에서** 계산한 지점 수와 전체 지점 수다 (단계가 바뀌면 다시 0부터).
- `failed`이면 `error`에 이유가 있다. 탐색 프로세스가 중간에 사라진 경우도 `failed`다.
- 없는 `run_id`는 404, 형식이 틀리면 422. CLI(`--run-id`)로 만든 예전 방식의 완료된 실행은 `state: "done"`으로 나온다.

`GET /candidates/runs/{run_id}`의 응답에는 임무 입력으로 만든 실행이면 `mission`(위 요청 본문과 같은 모양)이 들어가고, 아니면 `null`이다.
`GET /candidates/runs`는 **끝난 실행만** 나열한다 (진행 중인 실행은 `POST`가 준 `run_id`로 직접 추적한다).

## Tiles

### `GET /tiles/{layer}/{z}/{x}/{y}.png`

렌더링용 오버레이. `python -m lunar_margin.pipeline.overlay_tiles`가 수평선 테이블과 DEM으로 `DATA_DIR/tiles/`에 미리 굽는다. 없는 레이어·레벨·타일은 404.

| layer | 내용 |
| --- | --- |
| `horizon` | 지점마다 방위각 5° 간격(72개) 지형 수평선 고도. 셰이더의 지형 그림자(cast shadow)용 |
| `normal` | 지점마다 지역 동쪽·북쪽 경사. 셰이더의 햇빛 조명용. 레벨 0(500 m) 위에 더 촘촘한 레벨 1(160 m), 2(80 m)가 있고, 5 m 지역 DEM이 있는 곳에는 레벨 3(20 m), 4(5 m)가 더 있다 |
| `normal-wide` | `normal`과 같은 경사를 60°S까지(극에서 약 931 km) 960 m 격자 한 장으로. 85°S 밖도 햇빛으로 그리는 데 쓴다. 60°S까지의 DEM을 받아 구운 서버에만 있다 (없으면 404) |

### `GET /tiles/{layer}/meta.json`

```json
{
  "version": 1,
  "layer": "horizon",
  "levels": [{ "z": 0, "pixel_size_m": 500.0, "size_px": 607, "center_px": 303, "tile_px": 607, "tiles_per_side": 1 }],
  "encoding": { "azimuth_step_deg": 5.0, "azimuths": 72, "atlas_cols": 6, "atlas_rows": 3, "offset_deg": -5.0, "step_deg": 0.05 }
}
```

- 투영은 남극 입체투영(후보지 레이어와 같음). 레벨 전체 이미지의 픽셀 `(col, row)`는 `x_m = (col - center_px) * pixel_size_m`, `y_m = (center_px - row) * pixel_size_m` (경도 0°가 위쪽, 동쪽이 오른쪽). 격자 한 칸이 한 픽셀이다.
- 타일 `(x, y)`는 레벨 이미지의 열 `[x*tile_px, (x+1)*tile_px)`, 행 `[y*tile_px, (y+1)*tile_px)`를 덮는다 (`0 <= x, y < tiles_per_side`). 레벨 이미지(`size_px`)를 넘는 마지막 타일의 여백은 데이터 없음이다.
- 레벨 0은 두 레이어 모두 수평선 테이블 격자 그대로 타일 한 장이다 (500 m, ROI 밖은 데이터 없음). `horizon`은 레벨 0뿐이다.
- `normal`의 `levels`에는 같은 영역(극에서 `center_px * pixel_size_m`까지)을 더 촘촘히 덮는 레벨이 거친 것부터 이어진다. 한 장으로 받기에는 크므로(80 m 레벨 약 50 MB) 256px 타일로 나누고, 클라이언트는 보는 곳 주변 타일만 받는다. 이 레벨들은 원형 ROI 밖의 정사각형 모서리까지 DEM 값으로 채운다.

  ```json
  "levels": [
    { "z": 0, "pixel_size_m": 500.0, "size_px": 607, "center_px": 303, "tile_px": 607, "tiles_per_side": 1 },
    { "z": 1, "pixel_size_m": 160.0, "size_px": 1895, "center_px": 947, "tile_px": 256, "tiles_per_side": 8 },
    { "z": 2, "pixel_size_m": 80.0, "size_px": 3789, "center_px": 1894, "tile_px": 256, "tiles_per_side": 15 },
    { "z": 3, "pixel_size_m": 20.0, "size_px": 15151, "center_px": 7575, "tile_px": 256, "tiles_per_side": 60, "tile_ranges": [[24, 31, 28, 35]] },
    { "z": 4, "pixel_size_m": 5.0, "size_px": 60601, "center_px": 30300, "tile_px": 256, "tiles_per_side": 237, "tile_ranges": [[98, 124, 113, 139]] }
  ]
  ```

- `tile_ranges`가 있는 레벨은 희소 레벨이다: 5 m 지역 DEM(Artemis III 후보 지역의 Shape-from-Shading DEM, [data.md](data.md))이 덮는 곳에만 타일이 있다. 항목 하나가 지역 하나의 타일 범위 `[x0, y0, x1, y1]`(양 끝 포함)이고, 범위 안의 타일은 모두 있으며 밖의 타일은 404다. 범위 안이어도 지역 밖 픽셀은 데이터 없음이므로, 클라이언트는 그런 곳에서 더 거친 레벨을 쓴다. 지역 DEM을 받지 않았으면 이 레벨들은 `levels`에 없다. ROI(85°S) 밖의 지역은 들어가지 않는다.
- 20 m 레벨의 값은 5 m 간격으로 잰 경사를 픽셀 안에서 평균한 것이다.
- `normal`의 `encoding`은 `{ "bias": 32768, "scale": 16384 }`.
- `normal-wide`는 레벨 0 하나뿐이고 타일 한 장이다 (약 14 MB). 픽셀 좌표 규약과 `encoding`, 타일 형식은 `normal`과 같다. 픽셀 값은 240 m 간격으로 잰 경사를 그 픽셀 안에서 평균한 것이고, DEM 밖(정사각형 가장자리)은 데이터 없음이다. `sunlight`는 같은 구역의 햇빛 지도(`GET /sunlight/south-pole-wide.png`) 격자다.

  ```json
  {
    "version": 1,
    "layer": "normal-wide",
    "levels": [{ "z": 0, "pixel_size_m": 960.0, "size_px": 1941, "center_px": 970, "tile_px": 1941, "tiles_per_side": 1 }],
    "encoding": { "bias": 32768, "scale": 16384 },
    "sunlight": { "pixel_size_m": 640.0, "size_px": 2911, "center_px": 1455 }
  }
  ```

### `GET /tiles/{layer}/{z}/{x}/{y}.png`

8비트 RGBA PNG.

- `horizon`: `tile_px` 크기 셀 18개를 6열 x 3행으로 배치한 아틀라스 (`6*tile_px` x `3*tile_px`). 셀 `k`(열 `k % 6`, 행 `k // 6`)의 R, G, B, A가 방위각 `4k`, `4k+1`, `4k+2`, `4k+3`번(각 `5°` 간격, 0° = 북, 시계방향)이다. 값 `v = 0`은 데이터 없음, `1..255`는 고도 `offset_deg + v * step_deg`도 (범위 밖은 끝값으로 자름). 값은 수평선 테이블(엔진 `horizon_profile`)의 1° 값을 5°마다 그대로 뽑은 것이다.
- `normal`: `tile_px` x `tile_px`. R·G가 동쪽 경사, B·A가 북쪽 경사(북 = 위도가 커지는 방향, 즉 남극에서 멀어지는 방향. 수평선 방위각 0°와 같다)의 16비트 값 `u = hi*256 + lo`이고 경사 tan = `(u - bias) / scale`. 네 바이트가 모두 0이면 데이터 없음. 극점(경도 정의 안 됨)은 경도 0°로 본다. 동·북 방향은 픽셀마다 경도에 따라 돌아가므로, 이웃 픽셀 값을 보간할 때는 투영 평면의 공통 축으로 돌린 뒤 섞는다 (`horizon`의 방위각도 같다). 16비트 값이 두 바이트로 나뉘어 있어 GPU 선형 필터링·밉맵에 맡기면 값이 깨진다.

## Sunlight

### `GET /sunlight/sun-direction?time=`

한 시각에 달에서 태양을 향하는 방향. 태양이 멀어서 달 위 어느 지점에서나 같으므로(시차 0.001° 미만) 시각만으로 정해진다. 뷰어는 이 방향으로 조명을 그리고 아래 햇빛 지도를 요청한다.

- `time`: 타임존 포함 ISO 8601. 다른 쿼리 키는 거절한다.

```json
{ "time": "2027-01-10T00:00:00Z", "x": -0.894677, "y": 0.446459, "z": -0.01511 }
```

- `time`은 UTC로 바꾼 요청 시각. `x`, `y`, `z`는 `MOON_ME` 단위 벡터(빛 시간·광행차 보정 LT+S, `/analysis/*`의 태양과 같은 계산)를 소수 6자리로 반올림한 것이다. 같은 시각이면 언제나 같은 값이라, 이 값으로 요청한 햇빛 지도도 같은 것이 된다.

오류: `422` 시각이 없거나 타임존이 없음, `503` SPICE 커널 없음.

### `GET /sunlight/south-pole.png?x=&y=&z=`

태양 방향 하나에 대한 남극 햇빛 지도: 각 지점에서 지형에 가리지 않고 보이는 태양 원반의 비율. 뷰어 셰이더의 지형 그림자(cast shadow)에 쓴다. 그림자는 태양 방향마다 달라 미리 구울 수 없으므로 요청이 오면 DEM으로 계산한다 (약 3초, 메모리 약 0.8 GB). 한 번에 하나만 계산하고 최근 결과 8개를 메모리에 둔다. 클라이언트는 `429`를 받으면 `Retry-After`만큼 기다렸다가 몇 번 다시 요청한다.

- `x`, `y`, `z`: 달에서 태양을 향하는 `MOON_ME` 방향. 단위 벡터가 아니어도 된다. 서버는 정규화한 뒤 소수 4자리로 반올림한 방향으로 계산한다. 다른 쿼리 키는 거절한다.
- 응답은 8비트 RGBA PNG. `R = G = B = round(255 * 비율)` (0 = 완전한 그늘, 255 = 원반 전체가 보임), `A = 255`.
- 격자는 `normal` 타일에서 영역 전체를 덮는 가장 세밀한 레벨과 같다 (`GET /tiles/normal/meta.json`의 `levels` 중 `tile_ranges`가 없는 마지막 항목: 지금은 80 m, `size_px` x `size_px`, 픽셀 좌표 규약도 같다). 원형 ROI 밖의 정사각형 모서리는 태양 방위에 따라 계산 범위를 벗어날 수 있고 그때는 가장 가까운 값으로 채운다.
- 계산: 빛이 평행하다고 보고 태양 방위에 나란한 단면마다 지형을 태양 쪽에서 훑는다. 격자 밖 지형도 태양 쪽 200 km까지(320 m 간격) 반영하고 달 곡률을 포함한다. 태양 원반(반지름 0.2665°)을 고도 방향 16개 띠로 나눠 보이는 띠의 넓이를 합하므로 반그림자는 17단계다. 관측 높이는 0 m. `engine/horizon.py`의 수평선과 같은 DEM(80 m, 밖은 120 m)을 쓴다.

오류: `422` 방향이 없거나(영벡터, 성분 누락, 유한하지 않은 값) 수평 성분이 없는 방향(극의 천정), `429` 계산이 밀려 있음(계산 중인 요청 뒤에 4건까지만 줄을 세운다. `Retry-After` 초 뒤에 다시 요청한다. 이미 기억한 방향은 밀려 있어도 바로 돌려준다), `503` DEM 또는 `normal` 타일 없음.

### `GET /sunlight/south-pole-wide.png?x=&y=&z=`

같은 태양 방향의 넓은 햇빛 지도: 60°S까지(극에서 약 931 km)를 640 m 격자로 덮는다. 뷰어가 85°S 밖도 햇빛으로 그릴 때 쓰고, 85°S 안쪽은 위 80 m 지도가 더 세밀하다 (약 4초, 메모리 약 1.2 GB, 응답 약 1.1 MB).

- `x`, `y`, `z`와 응답 형식, 계산 방식은 위 지도와 같다.
- 격자는 `GET /tiles/normal-wide/meta.json`의 `sunlight` 항목이다 (`size_px` x `size_px`, 픽셀 좌표 규약은 타일과 같다). 정사각형 모서리(극에서 `center_px * pixel_size_m`보다 먼 곳)는 가장 가까운 값으로 채운다.
- DEM은 위 지도의 DEM(80 m, 밖은 120 m)에, 그 밖을 240 m DEM(`ldem_60s_240m_float`)으로 메운 것이다.
- 계산 줄과 `429`는 위 지도와 함께 쓴다. 최근 결과 8개를 위 지도와 따로 메모리에 둔다.

오류: `422`·`429`는 위와 같다. `503` 60°S까지의 DEM 또는 `normal-wide` 타일 없음 (`pipeline.fetch --wide`와 `pipeline.overlay_tiles`로 만든다. 이때도 위 지도와 창은 그대로 동작한다. 서버가 떠 있는 동안 데이터를 만들면 다음 요청부터 돌려준다).

### `GET /sunlight/south-pole/{level}/{tile_x}/{tile_y}.png?x=&y=&z=`

위 햇빛 지도의 세밀한 창. 5 m 지역 DEM이 있는 곳은 경사 타일이 20 m·5 m인데 그림자가 80 m면 경계가 뭉툭하므로, 클라이언트가 보는 곳 주변만 그 레벨의 격자로 다시 계산해 80 m 지도 위에 얹는다 (5 m 창 하나에 약 1초).

- `level`: `normal` 타일의 희소 레벨(`GET /tiles/normal/meta.json`의 `levels` 중 `tile_ranges`가 있는 항목: 지금은 20 m, 5 m)의 `z`.
- `tile_x`, `tile_y`: 창의 왼쪽 위 타일. 창은 그 타일부터 4 x 4 타일이다 (클라이언트가 경사 타일을 모아 쓰는 창과 같다. 5 m 레벨에서 5.12 km). 레벨 이미지 밖으로 나가도 되므로 음수일 수 있다.
- `x`, `y`, `z`와 응답 형식은 위와 같다. 크기는 `4 * tile_px` 정사각형이고, 픽셀 `(col, row)`는 그 레벨 이미지의 `(tile_x * tile_px + col, tile_y * tile_px + row)`다.
- 계산: 위와 같은 방식을 그 레벨의 격자 간격으로 한다. 지형은 창에 걸친 5 m 지역 DEM을 위 지도의 DEM 위에 얹은 것이다 (지역 DEM 밖은 80 m DEM 그대로). 창 밖 지형도 태양 쪽 200 km까지 격자 간격의 4배로 반영하므로, 멀리서 오는 그림자는 80 m 지도와 같은 자리에 온다.
- 계산 줄과 `429`는 위 지도와 함께 쓴다. 최근 창 32개를 메모리에 둔다. 한 번 시작한 계산은 요청이 끊겨도 끝까지 가므로, 클라이언트는 카메라가 멈춘 뒤에 요청한다.

오류: `404` 희소 레벨이 아니거나 창 안에 그 레벨의 타일(`tile_ranges`)이 하나도 없음(그런 곳은 위 지도를 쓴다), `422`·`429`·`503`은 위와 같다.

### 개발용 빠른 탐색: `POST /candidates/search/dev`

요청 본문과 응답 형태는 `POST /candidates/search`와 같다. 동일한 남극 ROI와 임무 기간,
NASA 데이터, 30분 시간 간격으로 계산하되, 거친 격자 20,000 m → 세밀 격자 10,000 m,
워커 4개로 제한한다. 거리 방향 지형 표본 간격은 유지한다.
`dev-v1-m-...` 실행 ID와 `config.json`으로 정밀 결과와 분리한다.
일반 탐색과 같은 동시 실행 제한(409)을 적용하며, 같은 개발용 입력은 결과를 재사용한다.
좁은 능선을 놓칠 수 있으므로 개발·화면 확인용이며 정밀 탐색의 대체 결과가 아니다.

실행 상태 응답에 다음 nullable 필드를 추가한다. 과거 상태 파일에는 null이다.

- `elapsed_seconds`: 처리 시작부터 현재 체크포인트까지, 완료/실패 시에는 고정된 총 초.
  프로세스의 단조 시계로 측정하며 결과 파일 저장 시간을 포함한다. 대기 시간은 제외한다.
- `completed_at`: 완료 또는 실패한 UTC 시각. 실행 중에는 null.

실행 상세의 `run`에도 `total_elapsed_seconds`, `started_at`, `completed_at`을 추가한다.
기존 `run.elapsed_seconds`는 계산 시간이며 `total_elapsed_seconds`는 결과 저장까지 포함한다.
새 실행만 총 시간을 기록하며 과거 결과의 시간을 추측해 채우지 않는다.

### POST /trajectory/descent-reference

가상 PDI에서 목표와 예비 착륙지의 기준 하강 경로를 평가한다. 요청·응답과 모델 한계는 [하강 기준 모델](descent-reference.md)에 있다. `include_earth_los=false`이면 LOLA DEM만 필요하다. 지구 시선은 동일 시각의 기하학적 지구 위치와 DEM을 사용한다. LOS 계산 구간이 SPICE 커널 범위를 벗어나면 422, 필요한 데이터가 없으면 503이다.

## 날짜별 지구–달 전이

`GET /trajectory/transfer?departure=2027-01-06T00:00:00Z&arrival=2027-01-10T00:00:00Z`

- 두 입력 모두 타임존이 포함된 ISO 8601 시각. 응답은 UTC로 정규화한다. 팝업은 선택 날짜의 00:00 UTC를 보낸다.
- 1900~2100년, 비행 간격 1~10일. 추가 쿼리 키는 거절한다.
- 지구 주차궤도 200 km, 달 도착 고도 100 km, 도착 후 전파 14시간. 주차궤도면·출발 위치는 모델에서 선택한다. 지상 발사장, 최소 Δv, 남극 궤도·착륙을 제약으로 사용하지 않는다. 도착 시각을 고도 100 km의 달 근접점(LOI)으로 맞춘다.
- DE440 달 위치·속도(`J2000`, `NONE`)를 30분 간격 cubic Hermite 보간. Lambert 초기 해를 지구·달 중력(지구 중심 간접항 포함)으로 전파하며 출발 속도와 달 주위 도착점 각도를 함께 보정한다. 도착 위치 잔차 0.05 km 이하, 달 중심 방사 속도 절댓값 0.00001 km/s 이하, 방사 가속도 양수(근접점)인 결과만 반환한다. 이것은 모델 내부의 수치 잔차이며 실제 항법 정확도가 아니다. 태양 중력·비구형 중력·유한 추력은 제외한다.

응답 필드:

| 필드 | 의미 |
| --- | --- |
| `departure`, `arrival` | 요청과 일치하는 UTC 시각 |
| `model` | 계산 모델 설명 |
| `earth_radius_km`, `moon_radius_km` | 기준 천체 반경 |
| `plane_x`, `plane_y` | 전체도 투영의 J2000 기준 단위 기저 |
| `capture_plane_x`, `capture_plane_y` | 달 중심 확대도의 진입 궤도면 단위 기저 |
| `metrics.travel_time_days` | 출발→도착 비행 시간 |
| `metrics.parking_orbit_altitude_km` | 지구 주차궤도 고도 |
| `metrics.arrival_altitude_km` | 실제 계산 도착 고도 |
| `metrics.arrival_position_error_km` | 목표점 대비 3차원 위치 잔차 |
| `metrics.tli_delta_v_km_s`, `metrics.loi_delta_v_km_s`, `metrics.total_impulsive_delta_v_km_s` | 벡터 차이로 계산한 출발·진입·합산 Δv |
| `metrics.post_loi_min_altitude_km` | 진입 후 표본의 최소 고도 |
| `transfer`, `capture` | 출발→도착과 진입 후 좌표 표본 |
| `moon_orbit_km` | 출발 후 29일간 달의 지구 중심 J2000 위치 표본 |

전이는 SPICE 도착·출발 ET의 차이로 전파한다. 좌표 표본의 경과 초는 윤초를 포함하는 TAI 경과시간이고, `travel_time_days`는 요청한 UTC 달력 일정의 일수다.

LOI 상태 경계(후속 DOI/PDI 연결을 위한 6차원 handoff):

- `loi_handoff.epoch_utc`: 정확한 LOI UTC 시각(요청한 `arrival`과 동일).
- `center="MOON"`, `inertial_frame="J2000"`, `fixed_frame="MOON_ME"`.
- `pre_loi_j2000_km_kmps`, `post_loi_j2000_km_kmps`: 달 중심 J2000 관성좌표계에서 [x,y,z,vx,vy,vz]. 위치 단위 km, 속도 km/s.
- `pre_loi_moon_me_m_mps`, `post_loi_moon_me_m_mps`: 같은 상태를 SPICE `sxform(J2000, MOON_ME, epoch)`의 **6×6 회전 프레임 상태변환**으로 변환한 [x,y,z,vx,vy,vz] (m, m/s). 달 회전으로 인한 속도 보정을 포함한다.
- LOI는 같은 위치에서 순간 속도만 변하는 접선원궤도화 모델이다. Pre/post 위치가 일치하고, 속도 차이의 크기가 기존 `metrics.loi_delta_v_km_s`와 일치하도록 검증한다.
- 이 상태는 **실제 생성된 Earth–Moon Transfer의 결과**이지, 이후 DOI/PDI나 착륙점 접근이 성립한다는 주장이 아니다. 전이 솔버는 자유롭게 궤도면을 선택하므로 착륙지·남극 궤도에 정렬되지 않을 수 있다. 지형고도, 실제 착륙선 질량, 유한추력·궤도면 변경, DOI 연료는 포함하지 않는다.
- 내부의 달 중심 상태는 전이 솔버와 동일한 Hermite 보간 달 위치·속도를 기준으로 산출한다. 공개 좌표 표본을 차분해서 임의 속도를 만드는 방식은 사용하지 않는다. 다음 단계에서 SPICE 정확 상태와 보간 오차를 별도로 평가해야 한다.
- #69의 현재 PDI는 가상의 목표지 기반 상태이므로 **자동으로 handoff를 연결하지 않는다**. 궤도면 정렬·DOI 전파·PDI 경계 검증을 별도 기능으로 개발한 후에만 연결 가능하다.

각 좌표 표본은 `{seconds, spacecraft_km: [x,y,z], moon_km: [x,y,z]}`. 시간은 출발부터 경과한 초, 위치는 지구 중심 J2000의 km. 전이 마지막 표본과 진입 첫 표본은 동일 시각·동일 위치이며 진입에서 접선 방향을 유지하며 속력만 순간 변경한다. LOI 전후 각각 10분 구간에 5초 간격 표본을 추가한다. 확대도는 각 표본의 달 위치를 뺀 뒤 진입 궤도면에 투영한다.

오류: `422` 입력 오류·비수렴·충돌 경로, `503` SPICE 파일 없음, `429` 동시 계산 한도(2건) 초과. 계산 한 건은 최대 약 20초로 제한한다. 정적 궤도로 대체하지 않는다.


### POST /trajectory/doi-pdi-reference

전이의 LOI 상태에서 목표 지점과 정렬되는 DOI/PDI 기준 궤도를 탐색한다. 요청·응답과 정렬 오차의 의미는 [DOI/PDI 기준 모델](doi-pdi-handoff.md)에 있다. 출발·도착 시각은 UTC로 정규화한다. 전이 솔버의 동시 계산 한도(2건)를 `GET /trajectory/transfer`와 공유하며, 이 경로 자체의 한도는 1건이다. 한도 초과 시 429를 반환한다.

### 후보지 탐색의 실제 지형 경사 필터

`POST /candidates/search`와 `/search/dev` 모두 `max_terrain_slope_degrees`를
거친 단계의 적격 판정·세밀화 우선순위와 세밀 단계의 최종 적격 판정에 적용한다.
수평선 테이블을 재사용하더라도 지역 지형은 주 DEM에서 별도로 계산한다.
넓은 보충 DEM은 수평선 광선에만 쓰며 지역 지형 결측을 메우지 않는다.
지역 유효 표본은 경사와 400 m 거칠기 창 모두 유효해야 한다.

- 초과 사유: `terrain_slope_above_max`. 결측/불완전 사유: `terrain_incomplete`.
- 새 결과의 `config.thresholds.max_terrain_slope_degrees`가 실제 적용 한도다.
- 후보의 nullable `terrain`: `slope_p95_deg`, `coverage_fraction`,
  `assessment_radius_m`(250), `slope_baseline_m`(160), `roughness_window_m`(400),
  `dem_pixel_m`, `landing_safety_status`(`UNVERIFIED`). 비활성화/과거 실행은 null 또는 생략.
- `candidates.csv`와 `sites.npz`에도 경사 및 유효 표본 비율을 저장한다.
- 임무 실행 캐시 버전을 2로 올려 과거 미적용 결과를 새 탐색에 재사용하지 않는다.
  과거 결과는 계속 읽을 수 있으며 화면에는 미적용으로 표시한다.

이는 DEM 규모의 환경 선별이다. 80 m 지형으로 발판·미세 장애물·지반 지지력 등
착륙 안전성을 인증하지 않으며, 경사 조건 비활성화는 안전 확인을 뜻하지 않는다.

## Eligible-grid pricing (`/pricing`)

These additive endpoints use the completed precision searches from #13. They do
not change the candidate search contract, thresholds, ranking or selection.

`POST /pricing/calendar` reads saved runs; it **does not launch a search**.

```json
{
  "mission": {
    "landing_date": "2027-01-10",
    "mission_duration_days": 14,
    "max_continuous_darkness_hours": 24,
    "max_communication_blackout_hours": 6,
    "max_terrain_slope_degrees": null,
    "search_region": "south",
    "optimization_priority": "balanced",
    "observer_height_m": null
  },
  "landing_dates": ["2027-01-08", "2027-01-09", "2027-01-10", "2027-01-11", "2027-01-12"],
  "mass_kg": 24,
  "delivery": "surface"
}
```

`mass_kg` is finite, >0 and <=1,000,000. Delivery is `orbit`, `surface` or
`rover_delivery` ($300,000, $1,200,000, $4,500,000/kg respectively, from the
[2022 Astrobotic PUG](https://www.astrobotic.com/wp-content/uploads/2022/01/PUGLanders_011222.pdf)).
These are published reference tariffs, not a verified current booking quote.
Dates must be 1–5 unique ISO dates; every date + mission duration must be within
the existing ephemeris coverage. Invalid input returns 422.

Each date replaces only `mission.landing_date` to derive the same deterministic
run ID as `POST /candidates/search`. The response echoes `mass_kg`, `delivery`,
`tariff_usd_per_kg`, and includes `dates` and term-level `evidence`.

Each date row contains `landing_date`, `run_id`, `state`, `message` (nullable),
and `pricing` (nullable). States:

- `ready`: completed run, at least one priced cell.
- `no_eligible`: completed run, no priced cells; mean is null, never zero.
- `not_computed`: no complete saved result. Start with the existing search API.
- `running`: queued/running search; message includes its stage and point counts.
- `failed`: failed search, with its recorded error.
- `unavailable`: inconsistent/missing artifacts or a non-500m run. Do not substitute prices.

`pricing` has `run_id`, `landing_date`, `mission_duration_days`, `grid_spacing_m`
(always 500), `counts`, `mean` (nullable), and `cells` (empty for calendar requests).
Counts are `fine`, `eligible`, `priced`, `terrain_excluded`, `terrain_unknown`,
`unevaluated`, and `coarse_ignored`.

The population is **all evaluated fine samples** with `stage=1`, `spacing_m=500`,
`status=eligible`, and no skipped required constraints, read from `sites.npz`.
It is not the final Top-K selection, a viewport, or all unsampled terrain in the
ROI. Coarse-only samples, development (10km) runs, excluded and unevaluated points
are not included. A 500m cell is represented by its sample point; this does not
certify conditions at every location inside that cell.

Price eligibility is exactly the saved search eligibility above, including its
250 m regional slope P95, 160 m baseline, DEM completeness and configured slope
limit. Disabling the search slope filter also disables slope exclusion in price
calculation. There is no extra 10-degree center-slope gate or 5% area gate for a
saved search. The response includes `slope_policy` (basis `saved_search_eligibility`,
`max_slope_degrees`, statistic `p95`, `assessment_radius_m:250`, `slope_baseline_m:160`).

The existing 500 m-radius fraction of native 80 m DEM samples with slope ≤10°
remains a **cost adjustment input only**, not an eligibility criterion. Its value
may change the modeled price but cannot remove a search-qualified candidate.
Missing cost terrain still uses the explicit destination multiplier 1.10 fallback.
Legacy independent point quotes retain their existing policy; selected-candidate
company comparisons send `source_run_id` and read the same saved fine-grid status.
Unknown grids or mismatched landing dates return 409 instead of silently applying
a different terrain policy.

`P = F + c * m * (1 + 0.30 * (1-r)) * F_demand`, with default F=$500,000.
The six-persona model is not connected, so F_demand=1.00 and demand_unknown=true.
The pure pricing engine also supports n=1..6 with multiplier `1+0.08*(n-1)`.
The mean is an equal-weight arithmetic mean of **unrounded per-cell USD prices**.
The low/high range changes only F between $500,000 and $5,000,000; it is not
geographical min/max or a statistical confidence interval.

Every Price object (mean or individual) contains `baseline_usd`, `transport_usd`,
`destination_adjustment_usd`, `demand_adjustment_usd`, `fixed_usd`, `adjusted_usd`,
`range_low_usd`, `range_high_usd`, `destination_multiplier`, `demand_multiplier`,
`destination_unknown`, `demand_unknown`, and `grade` (always `modeled`).
Destination adjustment precedes demand adjustment, and fixed cost stays outside
multipliers. Display USD millions with two significant digits; do not round
before averaging. Evidence distinguishes the derived terrain ratio from modeled
coefficients and unknown sources (`source: null`). Vehicle capacity, flight
availability, rocks and actual commercial demand are not verified by this model.

`GET /pricing/runs/{run_id}?mass_kg=24&delivery=surface&include_cells=true`
returns the same `pricing` object, with all eligible samples in `cells`:
`id`, `x_m`, `y_m`, `landable_fraction`, `aim_slope_deg`, `price` (nullable), and
`excluded_reason` (nullable). Terrain exclusions retain a row with no price.
`include_cells` defaults to false. Missing runs return 404, unsuitable/incomplete
artifacts return 409, and invalid cargo/IDs return 422.

The date planner starts missing dates using `POST /pricing/calculate` (below).
Departure affects only the 3–150 day transit eligibility gate; it adds no price
multiplier. The planner makes no flight-availability claim.

### Published provider comparisons

These additive endpoints distinguish the six named delivery providers from the
historical single-tariff benchmark above. They do not mutate searches or bookings.
Data sources, unknown-value policy and measured scope: [provider-pricing.md](provider-pricing.md).

- `GET /pricing/providers/catalog`: versioned six-provider catalog, `checked_on`,
  published sources, day/month/year/NET schedule precision, nullable public terms.
- `POST /pricing/providers/calendar`: the existing calendar input plus unique
  `departure_dates` (1–5) and optional `source_run_id`. Returns `mass_kg`, `delivery`,
  `mission_duration_days`, `catalog_checked_on`, `dates` and the departure × landing
  `cells`. Landing dates still pass the mission/ephemeris validator.
- `POST /pricing/providers/compare`: `departure_date`, `landing_date`, `mass_kg`,
  `delivery`, `x_m`, `y_m`. Returns the echoed context, all six `providers`, nullable
  `minimum_usd`, `destination_multiplier`, `terrain_unknown`, `demand_multiplier=1`
  and `demand_unknown=true`. Each provider lists its missions, issues, public rate,
  nullable fixed/minimum/step billing terms, capacity, sources and nullable price.

Calendar `dates` contain `landing_date`, `run_id`, `state` (`completed`,
`not_computed`, `running`, `failed`, `unavailable`) and nullable `message`.
An explicit saved source run is reused only if its mission conditions match;
edited conditions use their own search. Development grids never enter means.

Each calendar cell contains `departure_date`, `landing_date`, `run_id`, `status`,
`mean_min_usd`, `eligible_grid_count`, `terrain_unknown_count`, `quoted_grid_count`
and `eligible_provider_ids`. Statuses are `no_published_quote`, `search_required`,
`quoted`, `partial_coverage`, `no_eligible`, `invalid_transit`, `unavailable`.
`mean_min_usd` is non-null only for complete quote coverage of every originally
priceable 500m grid. A missing grid count is null, not a measured zero.
The response declares `aggregation=mean_of_grid_minima` and
`sampling=all_eligible_500m_grids`. Counts do not refer to Top-K candidates.

Unknown public flight data skip grid pricing entirely. Qualifying flights share
one per-date terrain read and vectorized per-provider comparisons. Repeated
departure cells with the same eligible flight set reuse those comparisons within
the request. Schedule matching adds no ad hoc time surcharge. A known rate alone,
an old benchmark tariff or a government mission contract total cannot qualify a
company quote; complete public billing, capacity, date and destination terms are
required. Non-null flight prices have no blocking issues and grade
`modeled_from_published_terms`. Prices are estimates, not a booking confirmation.

### Batch calendar calculation (environment analysis)

`POST /pricing/calculate` accepts the same body as `/pricing/calendar`. It returns
`{run_ids: string[], state: "queued" | "running" | "done", cached: boolean}` with
202 for one new background batch, or 200 when all dates are already complete or
one of the requested runs is already running. IDs remain the ordinary #13 mission
IDs in input date order. Completed dates are reused; only missing/failed dates
are included in the new job. A different active search returns 409 with its
`running_run_id`, using the same guard as `/candidates/search`. Launch failures
mark every queued date failed. Clients poll `/pricing/calendar` for progress,
failures and final prices; the planner uses a 250ms interval. Closing the planner
stops browser updates; an already launched batch continues on the server.

The batch shares worker startup and horizon reads across dates. Each date retains
its independently generated SPICE timestamps, thresholds, weights, coarse
promotion mask, fine 500m grid, eligibility, ranking, terrain gates and arithmetic
price average. Only the union of the requested fine points is scheduled, and each
date receives exactly its original subset. Visibility summaries are evaluated in
array batches; mean elevations retain the original compressed-array summation
order. Standard candidate JSON/NPZ and map artifacts are still produced, with
independent exports overlapping in at most three threads.

A complete matching horizon table is required for the batch path. Missing tables
or uncovered grid points fail visibly rather than falling back to slow terrain
ray tracing. The ordinary single-date search endpoint retains its existing
fallback behavior. The 15-second calendar target is measured with the local
precomputed table, five consecutive landing dates and a 14-day mission; it is
not a guarantee for arbitrary hardware, observer heights or mission lengths.

## 격자 예약 (추가 계약)

기존 후보지 응답은 변경하지 않는다. 정책·설치·DB migration은 [reservations.md](reservations.md)를 참고한다. 예약 API는 `RESERVATION_DATABASE_URL`이 있으면 직접 Postgres로 연결하고, 없으면 기존 `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`로 서버 전용 RPC를 호출한다. 두 방식 모두 미설정이거나 저장소에 연결할 수 없으면 503이다. Supabase URL은 프로젝트 기본 주소 또는 `/rest/v1/` 주소를 지원한다. 기존 분석/후보 탐색 API는 계속 사용할 수 있다.

공개 데모 정책에 따라 예약 확정·이력 조회·취소는 로그인과 운영자 토큰 없이 누구나 사용할 수 있다. 다른 방문자의 예약도 취소할 수 있다. `RESERVATION_ADMIN_TOKEN`이나 Supabase 운영자 해시는 사용하지 않으며 `Authorization` 헤더도 필요 없다. Supabase 서비스 키는 백엔드에만 보관한다. 중복 예약 제약·입력 검증·저장소 장애 시 503은 유지한다.

### GET /candidates/runs/{run_id}/availability

공개 조회, `Cache-Control: no-store`. 실행의 분석 기간과 후보 좌표로 실시간 예약 충돌을 판정한다. 후보 순서는 원래 과학 순위이며 과학 점수는 바꾸지 않는다.

```json
{
  "run_id": "m-example",
  "checked_at": "2026-11-14T20:00:00Z",
  "starts_at": "2027-01-01T00:00:00Z",
  "ends_at": "2027-01-15T00:00:00Z",
  "candidates": [{
    "candidate_id": "SP500_+1_-2",
    "cell_id": "SP500v1:1:-2",
    "cell_ix": 1,
    "cell_iy": -2,
    "status": "available",
    "available_rank": 1,
    "conflicts": []
  }]
}
```

`status`는 `available | reserved`. 예약된 후보는 `available_rank: null`이고 `conflicts`에 아래 예약 응답 배열이 들어간다. 충돌 회사·임무명·기간은 공개 후보 화면에 표시되는 정보다. 조회 실패/미확인을 `available`로 해석하지 않는다. 잘못된 ID 422, 없는 실행 404, 손상된 실행 500, 지원 범위 밖 격자 422.

### POST /reservations

공개 데모 예약, 인증 헤더 없음. 등록과 확정을 하나의 트랜잭션으로 수행한다.

```json
{
  "company": "Lunar A",
  "mission_name": "South pole 1",
  "cell_ix": 1,
  "cell_iy": -2,
  "landing_date": "2027-01-01",
  "mission_duration_days": 14
}
```

회사·임무명은 공백 제거 후 1~120자, 격자는 남극 고정 500m 셀, 기간은 정수 1~365일이다. 현재 분석 가능 기간(1850-01-01~2150-01-01 UTC) 안에 있어야 한다. cell ID·확정 시각·상태는 클라이언트에서 받지 않고 서버에서 생성한다. 겹치는 확정 예약이 있으면 409, 입력 오류 422, 저장소 미설정/연결 실패는 503이다. 충돌이 나면 availability를 다시 조회한다.

성공 201, 예약 응답:

```json
{
  "id": "88b02b95-e126-4c10-9d89-3a3b4417ff33",
  "cell_id": "SP500v1:1:-2",
  "cell_ix": 1,
  "cell_iy": -2,
  "company": "Lunar A",
  "mission_name": "South pole 1",
  "starts_at": "2027-01-01T00:00:00Z",
  "ends_at": "2027-01-15T00:00:00Z",
  "confirmed_at": "2026-11-14T20:00:00Z",
  "status": "confirmed",
  "cancelled_at": null
}
```

### GET /reservations?limit=100&offset=0

공개 조회, 인증 헤더 없음, `Cache-Control: no-store`. `limit` 1~100, `offset` 0 이상. 확정 시각 내림차순·UUID 순으로 `{"reservations": [예약 응답...]}`. 취소된 이력도 포함한다.

### POST /reservations/{id}/cancel

공개 데모 취소, 인증 헤더·본문 없음. 방문자 누구나 해당 ID의 예약을 취소할 수 있다. 성공 200과 취소된 예약 응답(`status: "cancelled"`, `cancelled_at` UTC). 이미 취소한 예약에는 같은 취소 시각을 반환한다. 다른 ID는 404, 잘못된 UUID는 422. 기록은 삭제하지 않고 해당 기간을 다시 예약할 수 있게 한다.

### 발사 예정일과 모델 예상 비용 (추가)

`GET /pricing/providers/launches` → `{timezone: "UTC", scope: "all_launches_demo", launches, sources}`.
각 launch는 `{id, provider_id: ProviderId|null, launch_provider: string, lunar_related: boolean, name, departure_date: date|null, label, confirmed: false,
sources: [{name, url, label}], date_precision, participants: [{provider_id, role}]}`이다. 월 단위·TBD 일정은 날짜를 null로 반환한다.
각 source 상태는 `{name, url, fetched_at, stale, error: string|null, scanned_records, scanned_pages, complete}`이다.
`date_precision`은 day/month/quarter/year/unknown, role은 delivery/launch/partner(본문 관련 언급)다.
두 소스의 전체 페이지 수집 실패 시 complete=false이며, 회사별 빈 결과를 확정적 부재로 해석하지 않는다.
10분 동안 응답을 재사용하며 외부 오류 시 확인일이 유지된 마지막 자료를 표시한다.

`POST /pricing/providers/compare`와 `/calendar`의 `estimate?: boolean`은 기본 false다.
true이면 공개 단가 또는 공통 참조 단가로 예상 비용을 계산한다. `/compare`의
`minimum_estimate_usd`와 provider의 `minimum_estimate_usd`가 모델 최솟값이다.
flight의 `estimate_usd`, `estimate_basis` (`public_tariff`|`common_model`),
`estimate_tariff_usd_per_kg`, `estimate_fixed_usd`, `estimate_tariff_source`,
`estimate_assumptions`가 계산 근거를 전달한다. 기존 `price_usd`, `minimum_usd`는
완전한 공개 조건을 충족한 견적만 담고 모델값으로 채우지 않는다.
`/calendar`의 `estimate`는 요청 모드를 반환하며 모델 평균은 cell.status `estimated`,
`mean_min_usd`에 담긴다. 기존 전체 격자 평균·부분 산정 규칙은 동일하다.
날짜와 청구 조건의 해석은 [launch-schedule.md](launch-schedule.md)를 참고한다.

데모에서는 목적지·회사로 목록을 제한하지 않습니다. 일반 발사도 분석용 출발일로 선택할 수 있으며 실제 달 배송 가능성을 뜻하지 않습니다.


`POST /pricing/providers/calendar`는 `estimate: true`일 때만
`selected_launch_id?: string|null`을 받는다. `/launches`에서 선택한 실제 ID를 보내면
캐시된 일정의 **발사사**로 회사 모델을 결정한다. 브라우저가 보낸 회사명·단가를 신뢰하지
않는다. ID가 없으면 해당 UTC 출발일에 등록된 발사사들의 격자별 최저가 평균 모드다. 존재하지 않는 ID는 409,
견적 모드에서 ID 지정은 422다. 계산 중 외부 일정 수집을 기다리거나 다시 실행하지 않는다.

선택 시 응답 `selection`은 `{launch_id, launch_name, company_id: ProviderId|null,
company_name, tariff_usd_per_kg, fixed_usd, billable_mass_kg,
tariff_basis: public_tariff|common_model, tariff_source, assumptions}`다. 미선택은 null이다.
해당 배송 방식의 회사 공개 단가를 우선하며 없으면 공통 참조 단가를 사용한다.
일반 발사에 달 배송 단가를 적용한 데모이므로 회사의 실제 달 운항 기간·화물 수용 여부는
적용하지 않는다. 기본 전이 3~150일·지형 부적합 판정은 유지한다.
`mean_min_usd`는 같은 적합 500m 격자 전체의 선택 회사 모델 산술평균이다.
단일 회사이므로 격자별 최솟값도 그 회사 가격이다. `eligible_provider_ids`는 알려진
6사 ID만 담으며 ULA 등은 빈 배열이다. 이 경우 `selection.company_name`으로 회사를 구분한다.

### Optional regional roughness filtering

`POST /candidates/search`, `/search/dev` and calendar mission inputs accept
`max_terrain_roughness_m`: a finite number ≥ 0, or `null`/omitted to disable.
This is the maximum 95th-percentile roughness in a 250 m radius, not slope in
degrees. Local roughness is the RMS elevation residual after removing a best-fit
plane over a 400 m window. The primary LOLA DEM resolution remains 80 m.

Coarse promotion and fine eligibility enforce the limit inclusively. An enabled
roughness filter requires 100% valid regional coverage; missing terrain never
passes as zero roughness. Excess roughness yields `terrain_roughness_above_max`;
incomplete/missing regional terrain yields `terrain_incomplete`.

Candidate `terrain.roughness_p95_m` is additive and nullable for historical runs.
It is also exported in CSV, `candidates_simple.json`, and `sites.npz` (as
`terrain_roughness_p95_m`). `/analysis/site-assessment` exposes the same regional
roughness field. The candidate table/detail and input summary show meters and
whether the saved run applied the limit. Mission cache version 3 prevents reuse
of runs that ignored this filter. This hard filter changes which candidates can
be ranked; it does not introduce an arbitrary roughness score weight.

RF communication changes are tracked separately; this roughness change preserves
the existing geometric Earth-visibility metric and scoring.

### 후보 상세의 지형 여유각·일조 연속성

PR #43의 지형 여유각 계산과 PR #44의 일조 연속성 계산을 후보 상세에 연결한다.
기존 API에 다음 선택 필드를 추가하며, 과거 응답에서 필드가 없을 때 프런트는 ‘미제공’으로 표시한다.

- `/analysis/illumination`, `/analysis/earth-visibility`:
  `series.terrain_clearance_deg`는 표본별 `천체 중심 고도 − 같은 방위각의 지형 수평선 고도` [°].
  `visible_clearance_p10_deg`는 양의 여유각 표본만의 10백분위수이며, 가시 표본이 없으면 null.
  새 필드는 계산 정밀도 그대로 제공한다. 기존 고도 배열의 표시용 반올림과 구분한다.
- `/analysis/site-assessment`:
  `terrain_clearance.sun_visible_p10_deg`, `earth_visible_p10_deg`로 두 천체의 여유각을 요약한다.
  `solar_continuity.longest_sun_visible_hours` [h], `visibility_transitions` [회]를 추가한다.
  마지막 표본은 `min(표본 간격, 요청 종료까지 남은 시간)`으로 집계한다. 예를 들어 10분 구간을
  30분 간격으로 요청해도 연속 일조는 최대 10분이다. 중간에 차폐가 있으면 연속 구간을 분리하고,
  시작과 끝의 가시 구간을 이어 붙이지 않는다. 전환 횟수는 실제 인접 표본 사이의 변화만 센다.

후보 선택 시 요약 GET 한 번으로 두 천체의 진단을 가져온다. 상세 진단 기간은 기존 시계열과 같은
‘임무 기간 전체 또는 시작부터 최대 1년’, 30분 간격이며 화면에 기간·간격·관측 높이를 표시한다.
선택 변경·닫기 시 요청을 취소하고, 로딩·오류/재시도·미제공·가시 구간 없음·진짜 0을 구분한다.
기존 시계열 보기 버튼과 분석 종류 탭은 유지한다.

지형 여유각 [°]은 기하학적 LOS 진단이며 RF 링크마진 [dB]이나 신뢰구간·통신 성공률이 아니다.
P10은 가시 구간에 조건부인 지표이므로 전체 기간의 가시율을 대체하지 않는다. 일조 연속성도
발전량·배터리 용량·정확한 일출/일몰 시각을 예측하지 않는다.

후보 결과에 PR #47의 선택적 `rf` 객체가 있으면, 저장된 `min_link_margin_db`를 별도 RF 항목에 표시한다.
해당 객체가 없거나 값이 null이면 ‘미계산’으로 표시하며 각도에서 RF 마진을 계산하지 않는다.
저장된 RF 값은 원래 탐색 기간의 명목 값이고, LOS 차폐 시에는 차폐 손실을 반영하지 않은 가상 LOS 값이다.
RF 계산·필터·점수 계산은 아래의 명목 RF 통신 평가 계약을 따른다.
### 명목 RF 통신 평가 (candidate search)

새 임무 탐색은 지구 중심 방향의 지형 LOS와 RF 링크 예산을 함께 평가한다.
`earth.*`, 지구 지도 레이어, `/analysis/earth-visibility`는 계속 **기하학적 LOS**다.
`rf.*`는 별도 지표이며 `LOS && link_margin_db >= target_margin_db`인 시간만 통신 가능하다.
실제 지상국 위치·가시성·일정, 지구 대기 감쇠, 멀티패스는 모델에 포함되지 않는다.

`POST /candidates/search` 및 날짜별 탐색의 임무 입력에 다음 선택 필드를 추가한다.

- `min_communication_fraction`: null 또는 0~1. RF 통신 가능 비율의 하한. 생략하면 하한 없음.
- `rf`: 아래 기준값을 갖는 RF 조건 객체. 생략하면 팀에서 제공한 기준값으로 평가한다.
  부분 객체도 가능하며 생략한 값은 기준값으로 채운다. null은 허용하지 않는다.

| RF 조건 | 기준값 |
| --- | ---: |
| frequency_hz | 23170000000 |
| tx_power_w | 1 |
| tx_gain_dbi / rx_gain_dbi | 33.2 / 71.1 |
| tx_system_loss_db / tx_pointing_loss_db | 1 / 0.3 |
| rx_pointing_loss_db / rx_waveguide_loss_db | 0 / 0 |
| system_noise_temp_k | 512 |
| information_rate_bps | 230000 |
| implementation_loss_db / target_margin_db | 3 / 3 |
| required_esn0_db / eta_tot | -2.35 / 0.490243 |

주파수·전력·잡음온도·정보율·효율은 양수, 손실·목표 마진은 0 이상이며 모든 값은 유한해야 한다.
수신 요구전력은 `−228.60 + 10 log10(T) + 10 log10(Rb) + Es/N0 − 10 log10(eta_tot) + 구현 손실` [dBW].
송수신 이득을 더하고 FSPL 및 시스템/지향 손실을 뺀 수신전력에서 이를 차감해 링크마진을 구한다.
목표 마진은 판정에 한 번만 사용한다. 385,000 km 기준 링크마진은 15.688618 dB,
목표 3 dB를 제외한 추가 손실 여유는 12.688618 dB다.

기준 출처: [NASA/TM-20220013310 Fig. 5.33](https://ntrs.nasa.gov/api/citations/20220013310/downloads/TM-20220013310.pdf),
[ETSI EN 302 307-1 V1.4.1 Table 13](https://www.etsi.org/deliver/etsi_en/302300_302399/30230701/01.04.01_60/en_30230701v010401p.pdf)
(QPSK 1/4, normal FECFRAME, no pilots). 하드웨어·실제 링크 검증 결과를 뜻하지 않는다.

`max_communication_blackout_hours`는 RF 최장 두절 한도로 적용한다.
저장 설정에는 `thresholds.min_rf_fraction`, `thresholds.max_rf_blackout_hours`와
모든 `config.rf` 값이 남는다. 기존 소비자용 `max_earth_blackout_hours`도 같은 한도로
유지한다(전체 30분 구간인 임무 탐색에서 RF 한도가 이를 포함하므로 추가 탈락은 없다).

각 후보의 선택적 `rf` 객체:

- `fraction`: 구간 길이로 가중한 명목 통신 가능 비율.
- `longest_blackout_hours`: LOS 차폐와 마진 부족을 합한 최장 연속 두절.
- `evaluation_hours`, `available_hours`: 정확한 평가 시간과 통신 가능 시간.
- `min_link_margin_db`: 전체 시점 중 최소 마진. LOS 차폐 시에도 가상 자유공간 LOS 값이며,
  차폐를 통과하거나 실제 수신 가능한 전력을 뜻하지 않는다.
- `required_ebn0_db`, `rx_required_dbw`: 사용한 수신 요구 조건.

마지막 표본이 짧으면 남은 시간만 집계한다. 처음과 마지막의 두절을 이어 붙이지 않는다.
`score.communication_component = (rf.fraction + 1 − rf.longest_blackout_hours / rf.evaluation_hours) / 2`.
가능 비율과 연속성에 같은 비중을 주고, 기존 balanced/solar/earth 우선순위로 일조 성분과
가중 평균한다. `score.earth_component`는 계속 원래 LOS 가시율이고,
`score.communication_basis`가 `nominal_rf`일 때만 새 통신 성분을 점수에 사용한다.
비율 하한·두절 상한 판정은 점수 계산과 별개이며 경계값을 포함한다.

개별·날짜별 일괄 계산, coarse/fine 승격, 최종 순위와 공간 다양성 선정에 같은 RF 지표를 쓴다.
JSON/CSV/simple JSON/`sites.npz`에 RF 지표를 보존한다. NPZ 실패/미적용 마스크는 uint16으로 확장한다.
새 제외 사유는 `rf_fraction_below_min`, `rf_blackout_hours_above_max`, `rf_incomplete`다.
RF 필터가 활성화된 상태에서 RF 지표가 결측이면 적격으로 통과시키지 않는다.
과거 결과는 `rf=null` 또는 필드 없음, 점수 기준은 `earth_los`다. 새 임무 캐시 버전은 `5-rf-roughness`로
바뀌어 LOS만 평가한 결과를 재사용하지 않는다. RF 없이 직접 만든 기존 CLI `SearchConfig`는
계속 LOS 방식으로 평가한다. 프런트 배포 전에 이 추가 API 계약을 백엔드와 함께 검토해야 한다.

메인 대시보드의 TOP 5는 저장된 탐색 결과를 그대로 사용한다. RF로 계산한 실행이면
`config.rf`의 조건, 최소 RF 가능 비율·최장 RF 두절 한도, 저장된 후보 RF 지표와 점수를 표시한다.
과거 LOS 실행은 RF 실행으로 다시 해석하지 않는다. 선택 지점의 Earth 시계열과 타임라인은
기존처럼 LOS를 나타내며, RF 지표는 저장된 탐색 결과임을 별도로 표시한다.

최소 RF 통신 가능 비율 입력은 ‘RF 기준 조건’ 펼침 영역에 둔다. 기본 임무 입력은 기존 2줄 구성을 유지한다. RF와 거칠기 지표를 함께 보존하며, 신규 임무 캐시 버전은 `5-rf-roughness`이다.

모델 날짜표 cell의 `lowest_company_names: string[]`는 각 적합 격자의 최저가 계산에
기여한 발사사 이름이다. 동률·격자별 다른 최저가 회사는 모두 포함한다. 가격이 없는
셀은 빈 배열이다. `lowest_launch_id: string|null`는 기여 회사가 하나일 때 해당 공개
발사편 ID이며, 여러 회사가 기여하면 null이다. 엄격한 공개 견적 모드에서는 이 추가
모델 필드를 기본 빈 배열/null로 반환한다.

`estimate:true`에서 발사편을 선택하지 않으면 `/launches`의 해당 UTC 출발일에
등록된 발사사 모델끼리만 비교한다. 선택 시에도 해당 편의 예정일만 허용한다.
해당 날짜에 발사편이 없거나 날짜가 미정이면 `status: no_launch`와 null 가격을
반환하며 DEM을 계산하지 않는다. 월·연도를 임의의 출발일로 확장하지 않는다.
회사당 지형 분석을 반복하지 않고 저장된 목적지 계수에 모델 가격 벡터를 적용한다.


### 가격 제외 사유의 표시

후보 표는 가격 API의 `excluded_reason`을 툴팁에만 숨기지 않고 가격 아래에 표시한다.
과거 응답의 중심 경사 제외는 실제 `aim_slope_deg`와 기존 10° 한도, 저경사 면적 제외는
`landable_fraction`과 기존 5% 한도를 함께 보여 준다. 가격 조회 실패·미산정과 구분한다.
회사별 `/pricing/providers/compare`의 선택적 `source_run_id`는 저장 검색의 500 m 세밀 격자를
식별한다. `terrain_excluded_reason: search_constraints_not_met`이면 그 검색의 제약 미충족이다.
검색 실행을 전달하지 않은 지도 지점은 독립 가격 모델이며 검색 후보의 판정으로 간주하지 않는다.

### GET /analysis/viewshed

주어진 남극 좌표(`lat`, `lon`, 도)에서 지정한 높이의 관측자가 반경 5 km 안의 표면을 볼 수
있는지 탐색과 같은 LOLA DEM으로 계산한다. `dem_name` 기본값은 `80s_80m`이다. 응답은 요청 좌표, 남극 극입체투영 중심
`center_x_m`, `center_y_m`, 125×125 격자의 행 우선 문자열 `cells`이다.
중심은 (62, 62), 열과 행이 증가할수록 각각 +x, +y 방향이다. 2는 가시,
1은 차폐, 0은 범위 밖 또는 결측이다. 기존 분석 엔드포인트처럼 데이터 미설치 시 503을 반환한다.

`eye_height_m`은 달 기준구 위 관측 눈높이이며 `rays`는 북쪽부터 시계 방향 15° 간격의
24개 수평 직선이다. 각 쌍은 [거리(m), 지형 교차 여부]다. 첫 DEM 교차에서 멈추며,
반경 끝이나 결측에서 중단된 선에는 교차점을 표시하지 않는다.

`targets`는 800 m 표시 격자의 [목표점, 첫 차폐점 또는 null] 목록이다. 각 위치는
[경도°, 위도°, 기준구 위 고도 m]이고 경로에 결측이 있는 목표는 생략한다.

면의 각 80 m 격자 중심과 표시 목표점에는 같은 차폐 판정을 쓴다. 시선이 DEM 보간
격자 경계를 통과할 때마다 구간을 나누고, 각 구간에서 쌍선형 지형과 곡률을 반영한
시선 간 높이 차(이차식)의 최솟값을 확인한다. 첫 차폐 구간에서는 진입 위치를
이분법으로 구한다. 차폐점은 해당 목표로 향하는 시선에 대한 값이다.

선택 매개변수 `observer_height_m`는 지면 위 관측 높이(m, 기본 2, 0~100)이다.
응답에 적용 높이를 포함하며 가시권, 목표점 차폐, 수평선 교차에 동일하게 적용한다.

### POST /trajectory/flight-preview

출발·달 궤도 진입 UTC와 목표 위경도(`latitude`, `longitude`)를 받아 궤도와 하강을 연결한다. `arrival`은 LOI 시각이다. 정렬된 PDI가 있으면 같은 위치·속도를 하강 엔진에 전달한다. `estimated_touchdown_utc`는 하강 기준 경로가 추력·연료·지형 조건을 통과한 경우의 PDI UTC + 평가된 하강 기간이다. 정렬 실패 또는 하강 조건 실패 시 null이다. 하강 기간과 착륙선 제원은 시나리오 입력이다.
