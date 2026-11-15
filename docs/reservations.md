# 착륙 격자 예약

운영자가 회사·임무명·격자·착륙일·표면 임무 기간을 등록하면 즉시 확정한다. 기존 확정 예약을 보호하며, 더 이른 착륙일을 입력해도 우선권을 빼앗지 않는다. 회사별 로그인과 승인 대기 단계는 이번 범위에 없다.

## 격자와 기간

- 고정 식별자 `SP500v1:{ix}:{iy}`는 탐색 실행 ID·순위·계산 간격과 독립적이다.
- 기존 후보 탐색의 달 남극 입체투영을 사용한다. MOON_ME, 구 반지름 1,737,400m, 극에서 축척 1, 경도 0° = +y, 동경 90° = +x.
- 투영 평면에서 500 × 500m이며 셀 중심은 `(500*ix, 500*iy)`이다. `ix=floor((x_m+250)/500)`, y도 동일하다. 경계는 `[중심-250, 중심+250)`으로 음수 좌표에도 같은 규칙을 적용한다. 투영 격자이므로 지표면의 정확한 측지 면적과는 차이가 있다.
- 위도 -90~-80° 남극 범위를 덮는 셀을 지원한다. 이 버전에서 인접 격자·착륙 분산·안전 반경까지 확장하지 않는다.
- 예약은 `[착륙일 00:00 UTC, 착륙일 + 표면 임무 기간)`이다. 종료 시각부터 다른 예약을 허용한다. 기간은 1~365일이다.
- 같은 격자 **그리고** 기간이 겹치는 확정 예약만 충돌한다. 취소 이력은 삭제하지 않는다.

Postgres의 부분 GiST exclusion constraint가 같은 격자의 겹치는 `tstzrange`를 거부한다. 서버 인스턴스가 달라도 동일하게 적용된다. 같은 셀의 확정 요청은 트랜잭션 advisory lock으로 직렬화해 동시 INSERT 교착을 피한다. DB 쿼리는 10초 제한이며 장시간 잠금 대기는 503으로 끝난다. 선조회 후 INSERT만으로 충돌을 판단하지 않는다. DB 연결 실패는 503이며 화면에서 예약 가능으로 해석하지 않는다.

## 후보지 랭킹 연결

기존 `/candidates/runs/{id}` 계약과 과학 점수·순위는 그대로 유지한다. 별도 `/availability`가 저장된 실행의 실제 분석 기간과 후보 좌표를 읽고 **현재** 확정 예약을 조회한다. 정렬은 원래 과학 순위 기준이고 예약 없는 후보에만 `available_rank`를 부여한다. 이 순위는 해당 실행의 Top-K 안에서의 순서이며, 제외된 후보를 다시 탐색해 채우는 전역 랭킹은 아니다.

후보 표에 상태·예약 가능 순위·충돌 회사/기간을 표시한다. 예약된 후보도 과학 결과와 지도는 열어볼 수 있지만 예약 확정은 차단한다. 새로고침/예약/취소 직후 최신 상태를 조회하며, 확정할 때는 DB가 다시 검증하므로 오래 열린 화면에서도 중복 예약되지 않는다. CLI 실행처럼 `mission.json`이 없는 결과는 조회만 가능하고, 화면에서 임무를 입력해 만든 실행에서 예약한다. 개발용 거친 탐색도 후보 **중심이 속한 500m 셀 하나**만 예약한다.

## 로컬 실행

```sh
# 저장소 루트, 개발용 Postgres. 처음 생성되는 볼륨에 migration이 적용된다.
docker compose -f compose.reservations.yaml up -d
docker compose -f compose.reservations.yaml exec postgres createdb -U lunar_margin lunar_margin_test
```

`api/.env`에 다음 키를 설정한다. 개발 DB URL은 `postgresql://lunar_margin:lunar_margin@localhost:55432/lunar_margin`이다. 테스트 URL은 같은 주소의 DB 이름을 `lunar_margin_test`로 바꾼 것이다. compose의 계정은 로컬 개발 전용이다.

- `RESERVATION_DATABASE_URL`: 백엔드 DB 연결 URL.
- `RESERVATION_ADMIN_TOKEN`: 직접 생성한 긴 임의 운영자 토큰. 환경변수 값과 동일한 토큰을 화면에 입력한다.
- `RESERVATION_TEST_DATABASE_URL`: 테스트 전용 DB. 기본값은 위 로컬 테스트 DB이다. 테스트는 이름이 `_test`로 끝나는 DB만 허용하며 예약 테이블을 비운다. 실제 예약 DB를 사용하지 않는다.

```sh
cd api
uv sync --locked
uv run fastapi dev src/lunar_margin/app/main.py
uv run pytest tests/test_reservations.py
```

프런트는 기존 `web/`의 `npm run dev`를 사용한다. 후보지 탐색 → 후보 ID 선택 → **운영자 예약 관리**를 펼친다. 토큰·회사·임무명을 입력하고 확정한다. **예약 이력 조회**에서 확정 예약을 취소할 수 있다. 토큰은 React 메모리에만 있고 브라우저 저장소에 남기지 않는다.

기존 로컬 볼륨이나 Supabase에는 migration을 별도로 적용해야 한다. CLI가 만든 `supabase/migrations/20261115010338_landing_reservations.sql`을 DB 소유 권한으로 적용한다. 새 볼륨용 자동 초기화와 달리 기존 볼륨에는 compose 재시작만으로 새 migration이 적용되지 않는다. 이후 API 환경변수를 설정하고 재시작한다.

## Supabase 배포

이번 PR은 원격 Supabase에 migration이나 운영자 토큰을 배포하지 않는다. 배포 시 위 migration을 검토·적용하고, Railway 백엔드에 Supabase의 직접 연결 또는 session pooler DSN(`sslmode=require`)과 운영자 토큰을 설정한다. DDL을 서버 시작 시 자동 실행하지 않는다.

`mission_reservations`는 Data API에 노출하지 않는 private schema이며 RLS가 켜져 있고 anon/authenticated 접근 정책은 없다. DB 소유자 또는 이 스키마에 권한을 부여한 서버 역할로 연결한다. 브라우저에 DB 비밀번호·service_role·운영자 토큰을 환경변수로 주입하지 않는다. 공유 운영자 토큰은 계정별 권한이나 변경자 식별을 제공하지 않는다.
