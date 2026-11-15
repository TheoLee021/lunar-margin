# 착륙 후보지 탐색 (남극)

일조와 지구 직접 통신(DTE) 지표로 **지리적으로 서로 떨어진 유망 후보지**를 뽑는 파이프라인.
이 문서는 설계, 설정, 출력 형식, 데이터 품질 규칙, 향후 전역(hybrid) 탐색으로 확장하는 방법을 정리한다.
코드는 `api/src/lunar_margin/engine/candidates/`(순수 계산)와 `api/src/lunar_margin/pipeline/candidates.py`(실행·출력).

## 1. 기존 데이터 조사 결과 (구현 전)

| 항목 | 결과 |
| --- | --- |
| 일조·지구 가시성 "데이터셋" | **파일로 저장된 격자는 없다.** 지점마다 DEM 수평선과 SPICE 천체 위치로 즉석 계산한다. 이 탐색이 그 계산을 격자 위에서 일괄로 돌린다. |
| 형식 | 지점별 시계열(가시 여부, 방위각, 고도) -> 요약 지표 4종(평균 비율, 최장 연속 암흑/두절, 24시간당 창 횟수, 평균 고도) |
| 좌표계 | 달 구 반경 1737.4 km, 남극 입체투영(극에서 축척 1), 경도 0° = +y, 동쪽 = +x. DEM과 동일 |
| 공간 해상도 | DEM 80 m (`80s_80m`) 또는 120 m (`75s_120m`). ROI(85°S 이남) 내 결측 픽셀 0개 |
| 시간 범위 | 천체력 DE440s: 1850~2150. 분석 기간은 설정값 |
| 지리적 겹침 | 두 지표가 같은 DEM과 천체력에서 나오므로 완전히 겹친다 |
| 재사용한 것 | `PolarDem`, `horizon_profile`, `summarize`/`find_runs`, SPICE 래퍼 |
| 새로 만든 것 | 역투영, 격자 생성, 일괄 계산(천체 벡터 1회 공유), 적격 필터, 연결 영역 라벨링, 점수, 선정 |

## 2. 구조

```text
engine/candidates/            # HTTP와 무관한 순수 계산. 부품이 서로 독립이다
├── config.py       SearchConfig (ROI, 간격, 임계값, 가중치, Top-K, 분석 기간 ...)
├── projection.py   극 입체투영 + 역투영 (m <-> 위경도)
├── grid.py         SitePoints, polar_grid(), refine_points()    ← 샘플링 계획
├── field.py        MetricField, compute_field()                 ← 지표 일괄 계산
├── filtering.py    evaluate()   필수 조건 (hard constraint)
├── regions.py      label_regions()  연결 영역
├── ranking.py      score_sites()    소프트 선호도
└── selection.py    select_diverse() 공간 다양성 선정
pipeline/
├── candidates.py       run_search(), write_outputs(), CLI
├── candidate_schema.py 출력 JSON 구조 (pydantic)
└── candidate_map.py    자체 완결 HTML 지도
```

```text
거친 격자(2 km) ─ compute_field ─ evaluate ─ score ─┐
                                                   ├─ 점수 상위 refine_fraction의 주변만
세밀 격자(500 m) ◄ refine_points ◄─────────────────┘
      │
 compute_field ─ evaluate ─ label_regions ─ score ─ select_diverse ─ Top-K
```

- **필수 조건과 선호도 분리**: `evaluate`가 임계값으로 적격 여부만 정하고, `score_sites`는 순위만 매긴다.
- **결정성**: 격자 순서, 라벨 번호, 동률 처리(점수 -> y -> x)가 모두 고정이라 같은 설정이면 `candidates.json`이 바이트 단위로 같다 (테스트로 확인).
- **병렬**: 천체 벡터는 한 번만 계산해 모든 워커에 넘기고, 지점 묶음을 `ProcessPoolExecutor`로 나눈다. 워커 수와 무관하게 결과가 같다.

## 3. 실행

```sh
cd api
uv run python -m lunar_margin.pipeline.fetch                  # 처음 한 번 (DEM 80 m·120 m + SPICE)

uv run python -m lunar_margin.pipeline.candidates                     # 결과: DATA_DIR/candidates/default/
uv run python -m lunar_margin.pipeline.candidates --run-id exp1 --config my.json --workers 8
open data/candidates/exp1/map.html                                    # 독립 실행 HTML 지도
```

`my.json`은 `SearchConfig`의 일부 필드만 적어도 된다 (나머지는 기본값):

```json
{
  "roi": {"min_lat_deg": -90, "max_lat_deg": -85},
  "grid_spacing_m": 500,
  "coarse_spacing_m": 2000,
  "min_separation_m": 2000,
  "top_k": 100,
  "thresholds": {"min_sun_fraction": 0.3, "max_sun_dark_hours": 400,
                 "min_earth_fraction": 0.3, "max_earth_blackout_hours": 400},
  "weights": {"sun": 0.5, "earth": 0.5},
  "window": {"start": "2027-01-01T00:00:00Z", "end": "2046-01-01T00:00:00Z", "step_minutes": 60}
}
```

## 4. 설정 (`SearchConfig`)

| 필드 | 기본값 | 설명 |
| --- | --- | --- |
| `roi.min_lat_deg` / `max_lat_deg` | -90 / -85 | 남극 위도 띠. 극 쪽이 min |
| `grid_spacing_m` | 500 | 최종(세밀) 격자 간격. 투영 평면 m |
| `coarse_spacing_m` | 2000 | 거친 단계 간격. `grid_spacing_m`의 정수배. `null`이면 한 단계 |
| `refine_fraction` | 0.25 | 거친 단계 적격 점 중 점수 상위 비율의 주변만 세밀화 (1.0이면 전부) |
| `min_separation_m` | 2000 | 선정 후보 사이 최소 거리 (경계 포함) |
| `top_k` | 100 | 선정 개수 |
| `thresholds.*` | 모두 `null` | 필수 조건. `null`이면 적용 안 함. 경계값 포함 (min은 `>=`, max는 `<=`) |
| `weights.sun` / `earth` | 0.5 / 0.5 | 점수 가중치 (비율만 의미) |
| `window` | 2027-01-01 ~ 2046-01-01, 60분 | 분석 기간 (아래 참고) |
| `dem` | `80s_80m` | 주 DEM (우선 쓰는 고해상도 DEM) |
| `fallback_dem` | `75s_120m` | 주 DEM 바깥(80°S 바깥)과 결측을 메우는 보충 DEM (합성 DEM). `null`이면 쓰지 않는다 |
| `max_range_m` | 200000 | 수평선 탐색 거리 |
| `coarse_azimuth_step_deg` / `fine_azimuth_step_deg` | 2 / 1 | 수평선 방위각 간격 |
| `exclude_incomplete_horizon` | false | true면 수평선이 불완전한 점을 적격에서 제외 |
| `workers` | CPU 코어 수 | 프로세스 수 |

**분석 기간**: 기본 19년은 월 궤도 승교점 주기(약 18.6년) 1주기를 덮는다. 지구 가시율이 연도에 따라 최대 약 0.07 달라지는 것(측정값)을 평균으로 흡수하기 위해서다.
기간이 길수록 평균 지표는 장기 평균에 가까워지고, **최장 암흑·두절 시간은 그 기간 중 최악값**이 된다. 천체력이 허용하는 범위(1850~2150)에서 100년도 가능하다 (아래 성능).

초기 실험 값(ROI 85°S 이남, 격자 500 m, 최소 간격 2000 m, Top-K 100)은 위 기본값 그대로이고, **임계값은 분포를 확인한 뒤 D(항공우주 담당)와 정한다**.
격자 간격이 DEM 해상도보다 거칠면 실행 때 경고를 `summary.json`에 남긴다.

## 5. 출력

`DATA_DIR/candidates/{run-id}/`(또는 `--out`)에 파일이 생긴다. API(`GET /candidates/...`)가 같은 폴더를 읽는다.

| 파일 | 내용 |
| --- | --- |
| `candidates.json` | 선정 후보(순위순) + 데이터 출처(DEM/커널 sha256, 투영, 분석 기간) + 설정 + 요약. 결정적 |
| `candidates.csv` | 같은 후보를 한 줄씩 평탄화 |
| `summary.json` | 개수 집계, 지표 분포(백분위), 경고, 실행 정보(시각·소요 시간·워커) |
| `sites.npz` | 표본 지점 전체(수십만 점)의 배열: 좌표, 지표, 상태, 영역, 순위 |
| `map.html` | 자체 완결 지도 (아래) |
| `map.json` + `layers/*.png` | 화면(프론트엔드)이 탐색 과정을 단계별로 재생하는 레이어 이미지와 지도 메타데이터 |

후보 한 건(`CandidateRecord`)의 필드: `id`, `rank`, `lat_deg`, `lon_deg`, `x_m`, `y_m`, `grid_spacing_m`,
`sun{fraction, longest_dark_hours, windows_per_24h, mean_elevation_deg}`,
`earth{fraction, longest_blackout_hours, windows_per_24h, mean_elevation_deg}`,
`eligibility{status, failed[], not_applied[]}`, `score{total, sun_component, earth_component, components_used}`,
`region_id`, `data_quality{horizon_complete, horizon_max_deg, missing_metrics[], stage}`, `selection{picked_as, note}`.
정확한 구조는 `pipeline/candidate_schema.py`.

**지도 (`map.html`)**: 네트워크 없이 열린다. 태양 일조율 / 지구 가시율 / 적격 여부 레이어를 라디오로 바꾸고,
수평선 불완전 영역(주황)과 선정 후보(순위 번호, 마우스를 올리면 지표)를 겹쳐 본다. 결측은 투명이다.
경도 0°가 위쪽, 동쪽이 오른쪽이고 점선이 ROI 경계다.

### 화면에서 탐색 과정 보기

`GET /candidates/runs`, `/candidates/runs/{id}`, `/candidates/runs/{id}/layers/{name}.png` (계약: [docs/api.md](api.md)).
레이어는 격자 한 칸이 한 픽셀인 PNG이고 단계에 대응한다.

| 단계 | 레이어 |
| --- | --- |
| 1. 거친 격자 | `coarse_sun`, `coarse_earth` |
| 2. 세밀화 영역 | `coarse_promoted` |
| 3. 세밀 결과 | `sun`, `earth`, `stage` |
| 4. 필터 | `eligibility` |
| 5. 연결 영역 | `regions` |
| 6. 선정 후보 | (후보의 `x_m`, `y_m`으로 지도 위에 표시) |
| 품질 | `quality` (수평선 불완전) |

`summary.counts`가 단계별 개수(퍼널), `summary.reasons`가 탈락·미선정 사유별 개수다
(`sun_fraction_below_min` 같은 필터 사유, `not_refined`, `within_min_separation`, `beyond_top_k`).
한 단계로 돌린 실행(`coarse_spacing_m: null`)에는 `coarse_*` 레이어가 없다.

## 6. 결측과 데이터 품질 규칙

- 결측 지표는 **0으로 취급하지 않는다.** NaN으로 남고, 지도에서 투명하다.
- 임계값이 있어도 그 지표가 결측이면 **그 조건은 적용하지 않고** `eligibility.not_applied`에 기록한다.
  판정할 근거가 하나도 없으면 `unevaluated` 상태이고 후보에서 빠진다.
- 점수는 결측 성분을 빼고 나머지 가중치로 다시 정규화한다. 둘 다 없으면 점수는 `null`이다.
- 제외 사유는 점마다 남는다: 위반한 조건(`failed`), 최소 간격에 걸림(`within_min_separation`), Top-K 밖(`beyond_top_k`), 세밀화 안 됨(`not_refined`).
- **수평선 완전성**: 수평선 탐색 광선이 DEM 밖으로 나가면 `data_quality.horizon_complete = false`로 표시한다 (값은 DEM 안쪽 구간 기준으로 계산).
  기본은 표시만 하고, `exclude_incomplete_horizon`을 켜면 적격에서 뺀다.
- DEM 밖 지점은 모든 지표가 결측이고 `computed = false`다.

## 6a. 수평선: 보충 DEM과 사전 계산 테이블

**보충 DEM (합성 DEM)**: 주 DEM(`80s_80m`)은 80°S까지만 덮어서 ROI 바깥쪽 지점은 수평선 탐색이 DEM 밖으로 나간다.
`fallback_dem`(기본 `75s_120m`, 75°S 이남)을 두면 **80 m DEM을 우선 쓰고, 그 밖과 결측은 120 m DEM으로 메운다** (`CompositeDem`).
두 DEM이 같은 극 입체투영이라 투영 좌표로 바로 겹친다. 두 DEM 모두 `pipeline.fetch`가 함께 받고, 파일이 없으면 탐색이 오류와 함께 `fetch` 실행을 안내한다.
실데이터 테스트로 ROI 가장자리에서 `horizon_complete=false`가 0개가 되는 것을 확인했다.

**수평선 테이블**: 수평선은 지점·DEM·탐색 거리·관측 높이로만 정해지고 날짜와 제약에는 무관하다.
임무 입력 탐색에서는 시간 계산이 지점당 0.2 ms인데 수평선은 55 ms라서, 총 시간의 거의 전부가 같은 수평선의 반복 계산이었다.
그래서 한 번만 계산해 `DATA_DIR/horizons/{id}/`에 저장해 두고 이후 탐색은 읽기만 한다.

```sh
uv run python -m lunar_margin.pipeline.horizons --workers 12   # 기본 설정이면 약 29만 지점, 약 20분, 약 210 MB
```

- 고각은 0.01° 단위 int16으로 저장한다 (오차 0.005° 이내).
- 테이블 id는 DEM 파일, ROI, 격자 간격, 방위 간격, 탐색 거리, 관측 높이로 정해지고, 조건이 같고 ROI를 덮는 테이블이 있으면 자동으로 쓴다.
  없으면 지점마다 직접 계산하고 `summary.warnings`에 안내를 남긴다.
- 테이블을 쓰면 거친·세밀 단계가 모두 테이블의 방위 간격(기본 1°)을 쓴다.
- `meta.json`이 마지막에 쓰이므로 만들던 중인 테이블은 열리지 않는다.

**Storage로 공유**: 테이블은 git에 넣지 않고(`api/data/`는 무시됨) Supabase Storage의 비공개 버킷에 둔다.

```sh
uv run python -m lunar_margin.pipeline.horizons --upload     # service_role 키 필요 (백엔드·로컬에서만)
uv run python -m lunar_margin.pipeline.horizons --download   # 계산 대신 받기
```

- 파일은 32 MiB 조각으로 나눠 올린다 (플랜별 파일 크기 한도를 피하기 위해). 전체 sha256을 적은 `manifest.json`을 **마지막에** 올려서, manifest가 보이면 모든 조각이 올라가 있다.
- 받을 때는 임시 폴더에 조립해 sha256을 검증한 뒤에만 제자리로 옮긴다. 이미 있고 sha256이 맞으면 다시 받지 않는다.
- Storage 경로: `horizons/{table_id}/{파일}.partNNNN`, `horizons/{table_id}/manifest.json`. id는 설정이 정한다 (12자리 소문자 16진수만 허용).
- 환경변수: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`. 테스트는 가짜 서버로 했고 **실제 Supabase 프로젝트로는 아직 확인하지 않았다** (버킷 생성과 플랜별 한도 확인은 팀에서).

## 7. 검증으로 확인한 것

- **DEM 가장자리**: 80°S DEM(극에서 304 km)은 극에서 104 km보다 먼 점(ROI 면적의 약 절반)에서 200 km 탐색이 DEM 밖으로 나간다.
  같은 해상도에서 80°S 바깥을 가려 비교하니 불완전한 34개 지점의 수평선 차이는 **0.000°**였다. 즉 DEM 밖 지형은 이 표본에서 수평선을 올리지 않았다.
- **완전한 DEM**: `75s_120m`(75°S 이남, 120 m)는 ROI 40개 임의 지점이 모두 완전했다 (`80s_80m`은 22/40).
- **해상도 영향**: 80 m와 120 m DEM의 수평선은 평균 0.12~0.15°, 일부 방위에서 최대 약 2.7° 차이가 났다. 가장자리 잘림보다 해상도가 더 큰 영향이다.
- **분석 연도**: 같은 지점을 2026/2027/2028/2030년으로 비교하면 태양 일조율은 ±0.03, 지구 가시율은 최대 0.07 차이.
- **성능** (1 지점, 1 프로세스, 수평선 방위 2°): 1년/30분 32 ms, 19년/60분 39 ms, 100년/60분 76 ms. 100년 창도 14코어로 2 km 격자(약 1.8만 점)에 약 1.6분.
- **수평선 테이블 효과** (2027-01-01, 14일, 암흑 24시간·두절 6시간 한도, 균형, 실제 NASA 데이터, 2026-11-14 측정):

  | | 소요 시간 | 워커 | 수평선 불완전 |
  | --- | --- | --- | --- |
  | 수평선을 매번 계산 (80 m DEM만) | 1,146.6초 (약 19분) | 8 | 49,660 |
  | 수평선 테이블 + 합성 DEM | **2.6초** | 12 | **0** |

  - 시간 계산은 지점당 0.2 ms인데 수평선은 55.5 ms라서, 시간의 거의 전부가 같은 수평선의 반복 계산이었다.
  - 테이블은 한 번만 만든다: 289,277 지점, 12 워커로 약 40~50분 (다른 작업과 CPU를 나눠 쓴 값), 약 211 MB.
  - 결과는 같다: 적격 0개, 제외 사유 개수는 119,087 -> 119,008(암흑), 119,305 -> 119,230(두절)로 0.1% 안쪽이다
    (수평선을 0.01° 단위로 저장하기 때문). 워커 수가 달라 배율은 근사값이다.
  - 이 속도는 테이블이 있을 때다. 없으면 이전처럼 느리고 `summary.warnings`에 안내가 남는다.
  수평선 계산이 지배적이라 기간이 길어져도 비용은 크게 늘지 않는다. 방위각 간격 2°는 속도 2배에 평균 오차 0.008°이고, 거리 간격을 거칠게 하는 것은 최대 2° 이상 틀어져 쓰지 않는다.

## 8. 가정과 한계

- **격자 500 m는 DEM 80 m보다 6.25배 거칠다.** 극지의 일조는 수십 m 폭 능선에서도 달라지므로 좁은 일조 지점을 놓칠 수 있다. 세밀 단계의 간격을 줄여 확인한다.
- 투영 왜곡은 85°S에서 0.19%라 무시한다 (거리·간격은 투영 평면 m).
- 태양은 중심 기준이고 시반경(약 0.27°)은 반영하지 않는다. 관측 높이는 기본 0 m.
- 영구 음영 크레이터는 일조 0이라 필수 조건이 없어도 점수가 낮아 밀려난다. 반대로 점수에 쓰지 않는 조건(예: 최장 암흑)은 임계값으로만 거른다.
- 지형 경사·착륙 안전성은 포함하지 않는다 (범위 밖).
- 최장 암흑/두절은 분석 기간 중 **최악값**이다. 임무가 특정 기간이라면 그 기간으로 `window`를 맞추는 편이 의미가 있다.

## 9. 하이브리드 전역 탐색으로 확장하는 방법

핵심 경계는 `SitePoints`(샘플링 계획)다. 지점이 어디서 왔는지(`plan_id`, `spacing_m`)와 위경도·투영 좌표를 함께 들고 있어서,
`compute_field` 이후(필터, 영역, 점수, 선정)는 지점이 어떤 계획에서 나왔는지 몰라도 된다.

1. **샘플링 계획 추가**: `grid.py`에 `global_sparse_grid(spacing_deg, lat_range)`처럼 `SitePoints`를 돌려주는 함수를 더한다
   (위경도 격자, 극지는 제외). 극지 밀집 계획과 `SitePoints`를 이어 붙이면 한 번의 `compute_field`로 처리된다.
2. **DEM**: 전역에는 남극 입체투영 DEM으로 부족하다. LOLA 전역 원통도법 DEM(PDS에 `ldem_16`, `ldem_64`, `ldem_128` 등)을 읽는 `Dem` 구현을 더한다.
   `horizon_profile`이 쓰는 인터페이스는 `sample_height_lonlat_m` 하나뿐이라, 같은 메서드를 가진 구현을 끼우면 된다. 이때 `horizon_complete`가 계획별로 의미를 가진다.
3. **지역 투영**: 극지 밖에서는 입체투영 평면의 격자와 거리가 의미 없다. 영역 라벨링과 최소 거리는 격자 인덱스(`ix`, `iy`)와 투영 거리 대신
   대원 거리와 위경도 격자 인접을 쓰는 변형이 필요하다 (`regions.py`, `selection.py`의 거리 함수를 교체 가능하게 분리하면 된다).
4. **거친 -> 세밀 단계**: 이미 `refine_points`가 "유망 점 주변을 더 촘촘히"를 구현한다. 전역에서는 희소 샘플로 유망 지역을 찾고,
   그 지역만 지역 투영 격자로 세밀화하는 같은 구조를 쓴다.
5. **병합**: 계획별 결과를 `MetricField.concat`으로 합치고, 같은 설정의 임계값·가중치로 한 번에 선정한다. `plan_id`가 후보 출처를 남긴다.

## 10. 테스트

`api/tests/candidates/`(좌표 변환 왕복, 격자 점 수 대조, 경계 포함, 결측 처리, 임계값 경계, 연결 영역, 점수 정규화, 공간 중복 제거, 일괄 계산과 `analyze_site` 일치, 병렬 결과 동일),
`api/tests/pipeline/test_candidates_pipeline.py`(실데이터 소규모 종단 실행, 두 번 실행 시 바이트 동일, 후보 0개 처리), `test_candidate_map.py`(레이어·HTML).

## 임무 입력과 화면에서 탐색 실행

웹의 **후보지 탐색** 화면에서 착륙 날짜(UTC), 임무 기간, 최대 연속 암흑 시간,
최대 통신 두절 시간, 최적화 우선순위, 장비 높이를 입력하고 **후보지 탐색 실행**을 누른다.
착륙 날짜부터 임무 기간만큼이 분석 구간이다. 착륙 날짜 자체를 추천하지는 않는다.
한도를 비우면 해당 필터를 적용하지 않는다. 경사 입력은 현재 저장·검증만 하며
적격 판정에는 적용하지 않는다는 안내를 화면과 결과 경고에 표시한다.

- `POST /candidates/search`로 요청하고, 반환된 실행 ID의 `/status`를 2초마다 확인한다.
- 거친 격자, 세밀 격자, 결과 저장 순으로 **현재 단계 안의** 처리 개수와 비율을 표시한다.
  전체 진행률이나 남은 시간을 추측해서 표시하지 않는다.
- 계산이 끝나면 결과를 자동으로 열고, 6단계 지도(거친 결과 → 세밀화 영역 →
  세밀 결과 → 필수 조건 → 연결 영역 → 선정 후보)를 재생한다.
  단계 지도는 완료 후의 과정 재생이며 계산 중 실시간 지도는 아니다.
- 같은 입력의 완료 결과는 재사용한다. 다른 탐색이 실행 중이면 해당 실행을 따라가며
  완료 후 사용자의 입력으로 다시 요청하도록 안내한다.
- 상태 조회가 연속 3회 실패하면 재확인 버튼을 제공한다. 계산 실패 시 서버 오류를
  표시하고 같은 입력으로 다시 실행할 수 있다.
- 입력한 임무 조건은 결과 위에 다시 표시한다. 조건을 만족하는 후보가 없으면
  100개를 억지로 채우지 않고 빈 후보 목록과 제외 사유를 보여 준다.

검증: `cd web && npm run check`, 실제 API와 NASA 데이터가 준비된 상태에서
`npm run e2e -- e2e/mission.spec.ts`.
임무 E2E는 실제 저장 결과와 지도 API를 읽으며, 새 장시간 계산의 시작·상태 응답만
브라우저에서 대체한다. 전체 계산 자체는 백엔드 테스트와 실제 CLI 실행으로 검증한다.
기존 탐색 화면 E2E(`search.spec.ts`)는 별도로 `PORT=8765 npm run stub`이 필요하다.

### 실제 임무 입력 검증 기록 (2026-11-14)

예시 요청(`2027-01-01`, 14일, 연속 암흑 24시간 이하, 통신 두절 6시간 이하,
균형, 높이 미지정, 경사 10°는 미적용)으로 실제 NASA 데이터를 계산했다.
거친 점 18,073개에서 4,553개 주변을 세밀화해 세밀 점 106,144개를 계산했고,
중복을 제거한 평가 지점은 119,664개였다. 두 조건을 동시에 만족한 후보는 0개였다.
암흑 조건 초과는 119,087개, 통신 두절 조건 초과는 119,305개로 사유는 중복된다.
8개 워커로 1,146.6초가 걸렸다. 80 m DEM을 사용해 49,660개 지점에는
수평선 불완전 플래그가 붙었다. 이 결과는 샘플링한 지점에 대한 결과이며
남극 전체에 조건 만족 지점이 없다는 증명은 아니다.
실행 ID는 `m-0a4c88ca72`이고 결과는 git에 넣지 않는
`api/data/candidates/m-0a4c88ca72/`에 저장된다.

## 개발용 빠른 탐색과 시간 기록

폼의 **개발용 빠른 탐색 (20 km → 10 km)**을 선택하면 `/candidates/search/dev`를 사용한다.
같은 남극 전역을 더 거친 격자로 계산한다. 기본 API의 2 km → 500 m 설정은 유지한다.
임무 시간 간격과 지형 수평선의 거리 샘플 간격을 줄이지 않으므로 위치 샘플 수만 줄인다.
개발용 결과는 `dev-v1-m-...` 실행으로 구분되며 `config.json`에 실제 설정이 저장된다.
동일 입력의 정밀 탐색과 개발 탐색은 결과를 공유하지 않는다.

진행 패널은 서버 시작 시각을 기준으로 경과 시간을 표시하고, 종료 뒤에는 서버가 기록한
고정 소요 시간을 표시한다. `status.json`은 시작·완료 시각과 단조 시계로 측정한
총 소요 시간(결과 파일 저장 포함)을 기록한다. 결과 화면의 실행 정보에서도 조회할 수 있다.
캐시된 결과는 원래 실행 시간을 보여 주며 재계산 시간으로 해석하지 않는다.
거친 격자에서 후보가 0개여도 세밀한 지형에 적합한 지점이 없다는 뜻은 아니다.

실측 예시(2026-11-14): 착륙 2027-01-01, 14일, 암흑·두절 한도 각각 216시간,
균형, 높이 미지정, 경사 미지정으로 개발용 API를 실행했다. 거친 177개,
세밀 528개, 중복 제거 후 총 659개 지점을 평가해 3개를 선정했고,
4개 워커로 결과 저장까지 **28.07초**가 걸렸다. 같은 컴퓨터에서 별도 정밀 탐색이
진행 중이었으므로 성능 보장값은 아니다. 실행 ID: `dev-v1-m-371188c132`.
