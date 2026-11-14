# Lunar Margin API

착륙지 후보의 **일조 조건**과 **지구 직접 통신(DTE) 조건**을 NASA 데이터로 계산하는 백엔드.
작업 브랜치: `inseon` (진행 상황은 아래 "상태" 참고).

## 상태

| 항목 | 상태 |
| --- | --- |
| NASA 데이터 다운로드·검증 (`pipeline/`) | 완료 |
| LOLA 남극 DEM 읽기, 지형 수평선 (`engine/dem.py`, `engine/horizon.py`) | 완료 |
| SPICE 태양·지구 방위각/고도 (`engine/ephemeris.py`) | 완료 |
| 일조·지구 가시성 지표 (`engine/metrics.py`) | 완료 |
| API `GET /analysis/illumination`, `GET /analysis/earth-visibility` | 완료 (`docs/api.md` 계약 반영) |
| 오버레이 타일 사전 계산 (`/tiles/...`) | 미착수 |
| CI에서 SPICE 커널 캐시 | 미착수 (아래 "알려진 한계") |

## 빠른 시작

```sh
cd api
uv sync
cp .env.example .env
uv run python -m lunar_margin.pipeline.fetch     # DEM(231 MB) + SPICE 커널(약 46 MB), 처음 한 번 (약 20초)
uv run fastapi dev src/lunar_margin/app/main.py  # http://localhost:8000

curl "localhost:8000/analysis/illumination?lat=-89.45&lon=222&start=2027-01-01T00:00:00Z&end=2027-02-01T00:00:00Z"
```

데이터는 `DATA_DIR`(기본 `api/data/`, git 제외)에 저장된다. 배포에서는 Railway Volume 경로로 지정한다.
데이터가 없으면 분석 API는 `503`과 안내 메시지를 반환한다 (`/health`는 영향 없음).

```sh
uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest
```

첫 `pytest` 실행은 데이터를 내려받는다(네트워크 필요).

## 구조

```
src/lunar_margin/
  pipeline/
    sources.py     다운로드 대상 목록 (URL, 크기)
    fetch.py       다운로드 + sha256 manifest + 손상 파일 재다운로드
    pds_label.py   PDS3 .lbl 파서
  engine/          HTTP와 무관한 순수 계산
    dem.py         극 입체투영 DEM (쌍선형 보간, 결측은 NaN)
    horizon.py     방위각별 지형 수평선 고각 (달 곡률 포함)
    ephemeris.py   SPICE로 태양·지구의 방위각/고도 (MOON_ME 프레임)
    metrics.py     가시성 시계열 → 지표 요약
  app/
    analysis.py    분석 엔드포인트와 응답 모델
```

## 계산 방법

1. **수평선**: 관측점에서 방위각 1° 간격으로 DEM을 따라 최대 200 km까지 훑는다. 각 표본의 고각은 달 곡률을 포함해
   `tan(el) = (r1·cosθ − r0) / (r1·sinθ)` (r0 관측점 반지름, r1 목표 반지름, θ 중심각)로 구하고, 방위각마다 최댓값을 취한다.
2. **태양·지구 방향**: SPICE `spkpos`(`LT+S` 보정)로 달 중심에서 본 벡터를 `MOON_ME` 프레임에서 구하고, 관측점의 동·북·천정 기저에 투영해 방위각/고도를 얻는다.
3. **가시 판정**: 천체 중심의 고도가 그 방위각의 수평선 고각보다 높으면 가시.
4. **지표**: 가시 시계열에서 계산한다.

| 구분 | `visible_fraction` | `longest_dark_hours` | `windows_per_24h` | `mean_elevation_deg` |
| --- | --- | --- | --- | --- |
| 일조 (`illumination`) | 평균 일조율 | 최장 연속 암흑 시간 | 24시간당 일조 창 횟수 | 일조 중 태양 평균 고도 |
| 통신 (`earth-visibility`) | 평균 지구 가시율 | 최장 통신 두절 시간 | 24시간당 지구 가시 구간 횟수 | 가시 중 지구 평균 고도각 |

- 기간의 처음·끝에 걸친 암흑/가시 구간도 길이에 포함한다.
- `windows_per_24h` = 가시 구간 수 ÷ 기간(일).

## 좌표 규약

- 위도: 달 planetocentric, 남쪽이 음수 (`-90`~`-80`만 허용: DEM이 80°S 이남).
- 경도: 동경 양수 (0~360 또는 -180~180).
- 방위각: 0°=북, 시계방향 (동쪽 90°).
- 구 반경 1737.4 km, 프레임은 평균지구/자전축(`MOON_ME`). LOLA DEM 라벨과 같다.

## 예시 결과 (2027년 1년, 30분 간격)

> 좌표는 **예시용 근사값**이다. 공식 착륙 후보지가 아니며, 데모 후보는 D가 정한다.

| 지점 (lat, lon) | 일조율 | 최장 암흑(h) | 지구 가시율 | 최장 두절(h) |
| --- | --- | --- | --- | --- |
| 남극점 (-90.0, 0) | 0.495 | 356.5 | 0.067 | 644.0 |
| Connecting Ridge 근처 (-89.45, 222) | 0.441 | 469.5 | 0.327 | 439.5 |
| Malapert 산 정상 (-85.99, 0.12) | 0.472 | 375.0 | 0.984 | 39.0 |
| Haworth 크레이터 바닥 (-87.5, 355) | 0.000 | 8760.0 | 0.004 | 4955.0 |
| Shackleton 크레이터 안 (-89.9, 129.8) | 0.000 | 8760.0 | 0.000 | 8760.0 |

해석: 영구 음영 크레이터 바닥은 햇빛이 0%, Malapert 산은 지구가 거의 항상 보이고(98%), 남극점의 태양은 약 절반만 떠 있다.
한 지점 계산은 0.1~0.25초 정도.

## 가정과 한계

- 태양은 **중심** 기준이다. 시반경(약 0.27°)을 반영하지 않아 일조율이 약간 낮게 나올 수 있다 (극지 태양 고도는 최대 약 1.5°라 영향이 작지 않을 수 있음).
- 관측 높이 기본 0 m. `observer_height_m`로 0~100 m 지정 가능.
- 80°S 북쪽과 DEM 가장자리 밖은 계산하지 않는다. 수평선을 훑는 레이가 DEM 밖으로 나가면 그 구간은 무시한다.
- DEM 80 m 해상도라 작은 지형(수십 m 바위·언덕)은 반영되지 않는다.
- 시간은 UTC. 윤초는 반영하지 않는다 (2027년 예정 없음).
- 지형 고도는 태양·지구 방향 계산에 쓰지 않는다 (거리 대비 무시 가능).
- 분석 API는 계산 결과를 캐시하지 않는다.

## 후속 과제

- `ldem_85s_20m_float` 등 고해상도 DEM으로 교체(파일명만 `sources.py`에 추가).
- 태양 시반경 반영 옵션.
- 오버레이 타일(`/tiles/{layer}/{z}/{x}/{y}.png`) 사전 계산: 이 `engine/`을 그대로 쓰면 된다.
- CI에서 SPICE 커널을 `actions/cache`로 받아 커널 의존 테스트 실행 (현재 CI는 네트워크 다운로드가 필요).
