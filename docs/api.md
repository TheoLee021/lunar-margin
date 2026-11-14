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

## 날짜별 지구–달 전이

`GET /trajectory/transfer?departure=2027-01-06T00:00:00Z&arrival=2027-01-10T00:00:00Z`

- 두 입력 모두 타임존이 포함된 ISO 8601 시각. 응답은 UTC로 정규화한다. 팝업은 선택 날짜의 00:00 UTC를 보낸다.
- 1900~2100년, 비행 간격 1~10일. 추가 쿼리 키는 거절한다.
- 지구 주차궤도 200 km, 달 도착 고도 100 km, 도착 후 전파 14시간. 주차궤도면·출발 위치는 모델에서 선택한다. 지상 발사장, 최소 Δv, 남극 궤도·착륙을 제약으로 사용하지 않는다. 도착은 근접점으로 제한하지 않는다.
- DE440 달 위치·속도(`J2000`, `NONE`)를 30분 간격 cubic Hermite 보간. Lambert 초기 해를 지구·달 중력(지구 중심 간접항 포함)으로 전파하며 출발 속도를 보정한다. 도착 위치 잔차 0.05 km 이하인 결과만 반환한다. 이것은 모델 내부의 수치 잔차이며 실제 항법 정확도가 아니다. 태양 중력·비구형 중력·유한 추력은 제외한다.

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

각 좌표 표본은 `{seconds, spacecraft_km: [x,y,z], moon_km: [x,y,z]}`. 시간은 출발부터 경과한 초, 위치는 지구 중심 J2000의 km. 전이 마지막 표본과 진입 첫 표본은 동일 시각·동일 위치이며 진입에서 속도만 순간 변경한다. 확대도는 각 표본의 달 위치를 뺀 뒤 진입 궤도면에 투영한다.

오류: `422` 입력 오류·비수렴·충돌 경로, `503` SPICE 파일 없음, `429` 동시 계산 한도(2건) 초과. 계산 한 건은 최대 약 20초로 제한한다. 정적 궤도로 대체하지 않는다.
