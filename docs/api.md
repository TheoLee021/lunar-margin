# API 계약 (프론트 ↔ 백엔드)

관리: B. 변경 시 B에게 먼저 공유하고, 기존 응답을 깨지 않게 필드 추가 위주로 바꾼다.
백엔드 PR을 먼저 머지한 뒤 프론트 PR을 머지한다. 프론트의 zod 스키마(`web/src/api/`)와 백엔드 pydantic 모델은 이 문서와 일치해야 한다.

## 공통

- Base URL: 로컬 `/api` (Vite proxy → `http://localhost:8000`), 배포 `VITE_API_URL` (Railway)
- 시간: UTC ISO 8601 (`2027-01-15T12:00:00Z`)
- 좌표: 달 planetocentric 위도(남쪽 음수, 도), 동경 양수 경도(도, 0~360 또는 -180~180 입력 허용). 방위각 0°=북, 시계방향(동쪽 90°). 기준 구 반경 1737.4 km
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
