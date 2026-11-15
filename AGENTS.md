# Lunar Margin

## Goal
- 달 남극의 착륙 지점과 착륙 시점을 빠르게 비교·평가할 수 있는 직관적인 mission decision tool
- 환경 데이터를 보여주는 데서 끝나지 않고, mission requirements를 만족하는지 판단하고 실패 원인을 설명한다
- 데모 시나리오: TBD (D·F). 확대 장면은 남극(Artemis 후보지) 중심

## Stack
- Frontend (`web/`): Vite, React, TypeScript (strict), Tailwind v4, zod, CesiumJS (Cesium Moon 3D Tiles)
- Backend (`api/`): FastAPI, Python 3.14 (uv), Docker (`api/Dockerfile`은 Railway 배포와 로컬 `compose.yaml` 공용)
- DB/Storage: Supabase (필요할 때만, Auth 사용 안 함)
- 배포: Vercel (`web/`), Railway (`api/`, Dockerfile + Volume)
- CI: GitHub Actions (`.github/workflows/ci.yml` 하나)
- 새 프레임워크·라이브러리 추가 전 팀에 공유

## Layout
```
web/                   Vite 앱 (Vercel root)
  src/api/             API 클라이언트 + zod 스키마 (docs/api.md와 일치)
  e2e/                 Playwright 데모 시나리오
api/                   uv 프로젝트 (Railway root)
  src/lunar_margin/
    app/               FastAPI 앱·라우트·설정
    engine/            계산 로직 (SPICE, 지평선, 일조율, 통신). HTTP와 무관한 순수 계산
    pipeline/          NASA 데이터 다운로드·변환, 오버레이 타일 사전 계산
  tests/
docs/                  api.md (API 계약), data.md (데이터셋)
.claude/skills/        팀 공용 스킬 (고정 버전, 직접 수정 금지)
```

## Commands
```sh
# 백엔드를 띄우기만 할 때 (repo 루트, Docker만 필요)
docker compose run --rm api python -m lunar_margin.pipeline.fetch   # 처음 한 번: NASA 데이터를 api/data에 다운로드
docker compose up --build                          # http://localhost:8000, api/src 변경 시 자동 재시작

# 백엔드를 개발할 때 (api/, Python 3.14 + uv)
uv sync
uv run fastapi dev src/lunar_margin/app/main.py   # http://localhost:8000
uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest

# 프론트 (web/), Node 24 (.nvmrc)
npm install
npm run dev        # http://localhost:5173, /api → localhost:8000 프록시
npm run check      # lint + format:check + typecheck + test + build
npm run e2e        # 백엔드를 띄운 상태에서 실행 (처음엔 npx playwright install chromium)
```

## Contracts
- 프론트 ↔ 백엔드: `docs/api.md`. 변경 시 B에게 먼저 공유, 기존 응답을 깨지 않게 필드 추가 위주로
- 뷰어 ↔ 타일: `/tiles/{layer}/{z}/{x}/{y}.png`
- 3D 뷰어 ↔ 비교 UI: 선택된 착륙지·시각을 담는 공용 타입 하나로만 주고받기

## Architecture
- Cesium Viewer·카메라 상태는 React state로 관리하지 않는다. React는 UI 패널만 담당
- 오버레이는 이미지 한 장이 아니라 확대 수준별 타일로 제공. 가능하면 사전 계산
- 대용량 NASA 데이터(DEM, SPICE 커널)는 `web/public/`이나 git에 넣지 않는다. 백엔드 Volume 또는 Supabase Storage에 둔다

## Quality Bar
- 코드 품질은 실제 서비스 수준을 목표로 한다
- TypeScript `any` 금지, Python은 pyright strict 통과
- 외부 입력(API 응답, 폼, LLM 출력)은 스키마로 검증 (zod / pydantic)
- 모든 비동기 화면에 로딩·에러·빈 상태 처리. 빈 화면·무한 로딩 금지
- 기존 코드의 패턴·네이밍을 따른다. 새 패턴 도입 전 팀에 공유
- React 코드 작성 시 `vercel-react-best-practices` 스킬을 로드하고 CRITICAL·HIGH 규칙(워터폴 제거, 번들 크기)은 처음부터 적용. MEDIUM 이하(memo, 리렌더 미세 최적화)는 문제가 측정될 때만
- 기능 완료를 주장하기 전에 실제로 실행해서 확인 (빌드 통과 + 해당 화면 동작)

## Testing
- 계산 로직·데이터 변환·API 계약·외부 응답 파싱은 TDD (`tdd` 스킬)
- UI 컴포넌트는 테스트하지 않는다
- 테스트를 통과시키려고 테스트를 수정하지 말 것. 테스트가 틀렸다고 판단되면 먼저 사람에게 확인
- 데모 시나리오 E2E(Playwright) 1~2개 유지. CI에서는 돌리지 않으므로 머지 전 로컬에서 `npm run e2e` 통과 확인

## Workflow
- main에 직접 push하지 않는다. 브랜치에서 PR을 올린다. main은 항상 실행 가능한 상태
- 기능 하나당 PR 하나, 작게 자주
- PR 전 로컬에서 lint·typecheck·test·build 통과 확인
- CI 실패 시 머지 금지. 테스트 skip, lint 규칙 끄기 등으로 CI를 우회하지 말 것
- API 변경은 백엔드 PR을 먼저 머지한 뒤 프론트 PR 머지
- Issue tracker: GitHub Issues

## Secrets
- `VITE_`로 시작하는 환경변수는 브라우저에 공개된다. 공개돼도 되는 값만 사용
- 프론트에는 Supabase `anon` 키만. `service_role` 키는 백엔드 환경변수에만
- 필요한 환경변수는 `web/.env.example`, `api/.env.example`에 키 이름만 기록

## Out of Scope
- 확장성 대비 추상화, 마이크로서비스, 캐싱 레이어
- 로깅·모니터링 인프라, 로그인 기능
- staging 등 멀티 환경, 쿠버네티스·인프라 구성 (`ci.yml` 외 파이프라인 없음, 배포는 Vercel·Railway 자동 배포만)
- 데모 시나리오에 쓰이지 않는 기능
