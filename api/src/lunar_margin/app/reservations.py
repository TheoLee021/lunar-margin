"""운영자 확정/취소와 후보의 실시간 예약 가용성. 기존 후보 계약은 변경하지 않는다."""

import secrets
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError

from lunar_margin.app.candidates import RunId, get_run
from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.reservations.models import (
    Availability,
    Booking,
    BookingList,
    CandidateAvailability,
    Registration,
    cell_for_point,
)
from lunar_margin.reservations.store import Store
from lunar_margin.reservations.supabase_store import (
    ReservationConflict,
    ReservationUnavailable,
    SupabaseStore,
)

router = APIRouter(tags=["reservations"])
bearer = HTTPBearer(auto_error=False)


def settings_for(request: Request) -> Settings:
    return request.app.state.settings


SettingsDep = Annotated[Settings, Depends(settings_for)]


def store_for(settings: SettingsDep) -> Store | SupabaseStore:
    url = settings.reservation_database_url
    if url is not None and url.get_secret_value().strip():
        return Store(url.get_secret_value())
    if settings.supabase_url and settings.supabase_service_role_key:
        try:
            return SupabaseStore(settings.supabase_url, settings.supabase_service_role_key)
        except (ReservationUnavailable, ValueError) as error:
            raise unavailable() from error
    raise HTTPException(503, "예약 데이터베이스가 설정되지 않았습니다")


StoreDep = Annotated[Store | SupabaseStore, Depends(store_for)]


def operator(
    settings: SettingsDep,
    store: StoreDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    token = settings.reservation_admin_token
    configured = token is not None and bool(token.get_secret_value())
    if not configured and not isinstance(store, SupabaseStore):
        raise HTTPException(503, "예약 운영자 설정이 필요합니다")
    if credentials is None:
        raise HTTPException(401, "운영자 토큰이 필요합니다", headers={"WWW-Authenticate": "Bearer"})
    if configured and token is not None:
        authorized = secrets.compare_digest(
            credentials.credentials.encode(), token.get_secret_value().encode()
        )
    elif isinstance(store, SupabaseStore):
        try:
            authorized = store.authorize(credentials.credentials)
        except ReservationUnavailable as error:
            raise unavailable() from error
        if authorized is None:
            raise HTTPException(503, "예약 운영자 설정이 필요합니다")
    else:
        authorized = False
    if not authorized:
        raise HTTPException(401, "운영자 토큰이 필요합니다", headers={"WWW-Authenticate": "Bearer"})


Operator = Annotated[None, Depends(operator)]


def unavailable() -> HTTPException:
    # DSN, SQL, credentials and internal database messages must never reach clients.
    return HTTPException(503, "예약 저장소에 연결할 수 없습니다. 잠시 후 다시 확인하세요")


@router.post("/reservations", status_code=201)
def confirm(body: Registration, _: Operator, store: StoreDep) -> Booking:
    try:
        return store.confirm(body)
    except (psycopg.errors.ExclusionViolation, ReservationConflict) as error:
        raise HTTPException(409, "같은 격자에 기간이 겹치는 확정 예약이 있습니다") from error
    except (psycopg.Error, ReservationUnavailable) as error:
        raise unavailable() from error


@router.get("/reservations")
def list_bookings(
    _: Operator,
    store: StoreDep,
    response: Response,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> BookingList:
    response.headers["Cache-Control"] = "no-store"
    try:
        return BookingList(reservations=store.list(limit, offset))
    except (psycopg.Error, ReservationUnavailable) as error:
        raise unavailable() from error


@router.post("/reservations/{booking_id}/cancel")
def cancel(booking_id: UUID, _: Operator, store: StoreDep) -> Booking:
    try:
        result = store.cancel(booking_id)
    except (psycopg.Error, ReservationUnavailable) as error:
        raise unavailable() from error
    if result is None:
        raise HTTPException(404, "예약을 찾을 수 없습니다")
    return result


@router.get("/candidates/runs/{run_id}/availability")
def availability(
    run_id: RunId, settings: SettingsDep, store: StoreDep, response: Response
) -> Availability:
    response.headers["Cache-Control"] = "no-store"
    run = get_run(run_id, settings)
    config = SearchConfig.model_validate(run.config)
    try:
        cells = {
            candidate.id: cell_for_point(candidate.x_m, candidate.y_m)
            for candidate in run.candidates
        }
    except (ValueError, ValidationError) as error:
        raise HTTPException(422, "예약 격자는 달 남극(-90~-80도) 탐색 결과만 지원합니다") from error
    try:
        conflicts = store.conflicts(
            [cell.cell_id for cell in cells.values()], config.window.start, config.window.end
        )
    except (psycopg.Error, ReservationUnavailable) as error:
        raise unavailable() from error
    rank = 0
    candidates: list[CandidateAvailability] = []
    for candidate in sorted(run.candidates, key=lambda item: item.rank):
        cell = cells[candidate.id]
        matches = [booking for booking in conflicts if booking.cell_id == cell.cell_id]
        if not matches:
            rank += 1
        candidates.append(
            CandidateAvailability(
                **cell.model_dump(),
                cell_id=cell.cell_id,
                candidate_id=candidate.id,
                status="reserved" if matches else "available",
                available_rank=None if matches else rank,
                conflicts=matches,
            )
        )
    return Availability(
        run_id=run_id,
        checked_at=datetime.now(UTC),
        starts_at=config.window.start,
        ends_at=config.window.end,
        candidates=candidates,
    )
