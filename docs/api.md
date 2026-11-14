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

## Tiles

### `GET /tiles/{layer}/{z}/{x}/{y}.png`

TBD (layer 목록, 타일링 스킴, 투영)


### GET /analysis/site-assessment (새 API — 팀 리뷰 대기)

후보 하나에 대해 동일한 기간의 태양 일조·지구 기하학적 가시성·LOLA DEM 지형 특성을 함께 계산한다. 기존 /analysis/* 응답은 변경하지 않는다.

쿼리: lat (-90~-80), lon (-360~360), start/end (timezone-aware UTC, 종료 > 시작, 최대 28일), step_minutes (기본 30, 5~360), slope_baseline_m (기본 160, 80~2000), roughness_window_m (기본 400, 160~2000).

응답 예시(설명용 수치이며 NASA 실측 아님):

```json
{
  "lat": -89.5,
  "lon": 222.0,
  "start": "2027-01-10T00:00:00Z",
  "end": "2027-01-17T00:00:00Z",
  "step_minutes": 30,
  "sun": {
    "visible_fraction": 0.8,
    "longest_dark_hours": 36,
    "windows_per_24h": 1
  },
  "earth": {
    "visible_fraction": 0.7,
    "longest_dark_hours": 48,
    "windows_per_24h": 0.5
  },
  "terrain": {
    "elevation_m": 400,
    "slope_deg": 3.5,
    "roughness_rms_m": 1.0,
    "slope_baseline_m": 160,
    "roughness_window_m": 400,
    "dem_pixel_m": 80,
    "limitation": "DEM-scale terrain proxy; NOT boulder, footpad or landing-hazard clearance"
  }
}
```

계산 방식:
- 기존 horizon_profile()을 후보마다 1회 계산하여 Sun/Earth 두 시계열에 함께 적용한다.
- 기존 SPICE, visibility_series(), summarize()를 그대로 재사용한다.
- site_characteristics.py에서 160 m 간격의 2D 중심 유한차분 경사와 400 m 창의 평면 제거 RMS를 계산한다. 80 m DEM 해상도로 착륙선 발판 수준의 장애물 안전성을 보증하지 않는다.
- 별도의 우주선·태양전지 발전량·RF 링크 성공률 모델은 없다.
- 외부 NASA 자료가 준비되지 않으면 503, 유효 범위 밖·DEM 결측은 422를 반환한다.

메인 HUD는 같은 기간에 대해 후보별 평가를 요청하고, 지구 가시율 하한·최장 연속 암흑 상한·경사 상한을 모두 만족할 때 PASS로 판정한다. FAIL 결과도 목록에 유지하며 판정 근거를 표시한다. 임무 점수는 PASS 이후의 가시율 가중 순위 도구이고 실패 확률이 아니다.

