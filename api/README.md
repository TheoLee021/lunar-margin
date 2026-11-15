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
| 착륙 후보지 탐색 (남극, 거친→세밀) | 구현 (`docs/candidates.md`) |
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

## 사용하는 NASA 데이터

`uv run python -m lunar_margin.pipeline.fetch`가 `DATA_DIR`(기본 `api/data/`, git 제외)에 합계 약 501 MB를 받는다.
크기와 sha256을 `manifest.json`에 기록하고, 다시 실행하면 손상된 파일을 검증해 새로 받는다.
선정은 잠정이며 D 확정 대기다 (`docs/data.md`에 출처 URL·버전·선정 이유 정리).

| | 지형 데이터: LOLA 남극 DEM | 천체 위치 데이터: SPICE 커널 |
| --- | --- | --- |
| 출처 | NASA 달 궤도선(LRO)의 레이저 고도계 LOLA, PDS Geosciences | NASA JPL NAIF |
| 내용 | 달 남위 80°~90°의 높이 지도. 80 m 간격 7600×7600 격자, 반경 1737.4 km 구 기준 높이(km) | 어느 시각에 태양·지구가 달 하늘의 어디에 있는지 |
| 용도 | 한 지점에서 사방을 둘러볼 때 지형이 하늘을 가리는 정도(지형 수평선) 계산 | 시각별 태양·지구의 방위각·고도 계산 |
| 위치·크기 | `api/data/dem/` (225 MB) | `api/data/spice/` (44 MB) |

파일 목록:

| 파일 | 크기 | 역할 |
| --- | --- | --- |
| `ldem_80s_80m_float.img` | 231 MB | LOLA 높이 값 본체 |
| `ldem_80s_80m_float.lbl` | 4.8 KB | 격자 크기·투영 정보 (PDS3 라벨) |
| `ldem_75s_120m_float.img` | 232 MB | 보충 DEM: 남위 75°~90°, 120 m 간격 7624×7624 |
| `ldem_75s_120m_float.lbl` | 4.9 KB | 보충 DEM의 격자·투영 정보 |
| `de440s.bsp` | 32.7 MB | 태양·지구·달 위치 (JPL DE440 천체력, 축약형) |
| `moon_pa_de440_200625.bpc` | 12.9 MB | 달의 정밀한 자전·방향 |
| `moon_de440_250416.tf` | 19 KB | 달 좌표계 `MOON_ME` 정의 (LOLA DEM과 같은 좌표계) |
| `pck00011.tpc` | 131 KB | 천체 크기 등 기본 상수 |
| `naif0012.tls` | 5 KB | 윤초 정보 (UTC 시각 변환) |

### 보충 DEM (합성 DEM)

주 DEM(80 m)은 남위 80°까지만 덮어서, ROI 바깥쪽(남위 85° 부근) 지점이 극 반대쪽을 볼 때 수평선 탐색이 DEM 밖으로 나간다.
그래서 **80 m 값을 우선 쓰고, 그 밖이나 결측인 곳만 120 m 값으로 메우는 합성 DEM**(`CompositeDem`)을 쓴다.
두 파일이 같은 극 입체투영·같은 구(반경 1737.4 km)라 좌표 변환 없이 겹친다.
120 m 격자는 더 거칠어서 약 120 m보다 작은 지형은 뭉개지지만, 보충 영역은 먼 지형이라 수평선에 거의 영향이 없었다
(80°S 바깥을 가려 비교한 수평선 차이 0.000°, 같은 지점을 두 DEM으로 계산했을 때 해상도 차이는 평균 0.12~0.15°).
두 DEM은 80 m DEM과 보충 DEM 모두 `fetch`가 함께 받고, 파일이 없으면 탐색이 오류와 함께 `fetch` 실행을 안내한다.

### 수평선 테이블 (파생 데이터)

수평선은 지점과 DEM으로만 정해지고 날짜·제약과 무관해서, 한 번 계산해 `DATA_DIR/horizons/`에 저장해 두고 이후 탐색이 읽는다 (약 210 MB, git 제외).
`uv run python -m lunar_margin.pipeline.horizons`로 만든다. 자세한 내용은 [docs/candidates.md](../docs/candidates.md) 6a절.

만드는 데 20~50분이 걸려서, 한 번 만든 테이블은 Supabase Storage(비공개 버킷)로 공유한다.

```sh
uv run python -m lunar_margin.pipeline.horizons --upload     # 만든 테이블을 Storage에 올리기
uv run python -m lunar_margin.pipeline.horizons --download   # 계산 대신 Storage에서 받기 (sha256 확인)
```

`api/.env`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`(기본 `horizon-tables`)을 둔다. 올리기는 service_role 키가 필요하므로 백엔드나 로컬 스크립트에서만 한다.

**서버를 시작할 때 테이블이 없으면 위 설정이 있는 경우 자동으로 받는다** (백그라운드, 서버는 바로 뜬다). 배포에서는 `DATA_DIR`을 영구 Volume에 두면 다시 받지 않는다. `HORIZON_TABLE_DOWNLOAD_ON_START=false`로 끈다.

두 데이터는 이렇게 합쳐진다: 천체의 고도가 그 방향의 지형 수평선보다 높으면 "보인다"고 판정하고,
이 판정을 시간별로 쌓아 일조율·최장 암흑 시간·지구 가시율 같은 지표를 만든다 (자세한 방법은 아래 "계산 방법").

## 착륙 후보지 탐색

남극 ROI(기본 85°S 이남)를 격자로 훑어 일조·지구 가시성 지표를 계산하고, 필수 조건으로 거른 뒤
서로 떨어진 대표 후보 Top-K를 뽑는다. 설계, 설정, 출력, 확장 방법은 [docs/candidates.md](../docs/candidates.md).

```sh
uv run python -m lunar_margin.pipeline.candidates --out out/candidates   # map.html, candidates.json ...
```

- 거친 격자(2 km)로 먼저 훑고 유망한 영역만 500 m로 세밀화한다. 14코어에서 수 분~십수 분.
- 수평선이 DEM 밖으로 나가는 지점은 `horizon_complete=false`로 표시한다. 합성 DEM 덕분에 ROI 전체가 DEM 안에 들어와서 이 표시는 거의 나오지 않는다.
- 분석 기간 기본값은 2027~2046(19년, 월 궤도 승교점 주기). 임계값은 분포를 보고 D와 정한다.

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
