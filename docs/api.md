# API 계약 (프론트 ↔ 백엔드)

관리: B. 변경 시 B에게 먼저 공유하고, 기존 응답을 깨지 않게 필드 추가 위주로 바꾼다.
백엔드 PR을 먼저 머지한 뒤 프론트 PR을 머지한다. 프론트의 zod 스키마(`web/src/api/`)와 백엔드 pydantic 모델은 이 문서와 일치해야 한다.

## 공통

- Base URL: 로컬 `/api` (Vite proxy → `http://localhost:8000`), 배포 `VITE_API_URL` (Railway)
- 시간: UTC ISO 8601 (`2027-01-15T12:00:00Z`)
- 좌표: TBD (달 위경도 기준, 방위각 0°의 방향과 회전 방향을 여기 명시)
- 에러: FastAPI 기본 `{"detail": ...}`

## Endpoints

### `GET /health`

```json
{ "status": "ok" }
```

## Tiles

### `GET /tiles/{layer}/{z}/{x}/{y}.png`

TBD (layer 목록, 타일링 스킴, 투영)
