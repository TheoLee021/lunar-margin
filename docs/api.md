# API 계약 (프론트 ↔ 백엔드)

관리: B. 변경 시 B에게 먼저 공유하고, 기존 응답을 깨지 않게 필드 추가 위주로 바꾼다.
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
| `optimization_priority` | `"balanced"`(일조 0.5 : 지구 0.5), `"solar"`(0.75 : 0.25), `"earth"`(0.25 : 0.75). 점수 가중치이며 적격 여부와는 별개 |
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

TBD (layer 목록, 타일링 스킴, 투영)

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

각 좌표 표본은 `{seconds, spacecraft_km: [x,y,z], moon_km: [x,y,z]}`. 시간은 출발부터 경과한 초, 위치는 지구 중심 J2000의 km. 전이 마지막 표본과 진입 첫 표본은 동일 시각·동일 위치이며 진입에서 접선 방향을 유지하며 속력만 순간 변경한다. LOI 전후 각각 10분 구간에 5초 간격 표본을 추가한다. 확대도는 각 표본의 달 위치를 뺀 뒤 진입 궤도면에 투영한다.

오류: `422` 입력 오류·비수렴·충돌 경로, `503` SPICE 파일 없음, `429` 동시 계산 한도(2건) 초과. 계산 한 건은 최대 약 20초로 제한한다. 정적 궤도로 대체하지 않는다.


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
