"""Backend-only PostgREST RPC access to the private reservation schema."""

from datetime import datetime
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from pydantic import BaseModel, TypeAdapter, ValidationError

from lunar_margin.reservations.models import Booking, Registration


class ReservationUnavailable(Exception):
    """No availability or successful write may be inferred from an upstream failure."""


class ReservationConflict(Exception):
    """Postgres rejected an overlapping confirmed reservation."""


class _RpcError(BaseModel):
    code: str = ""


_bookings = TypeAdapter(list[Booking])
_authorized = TypeAdapter(bool | None)


class SupabaseStore:
    def __init__(self, url: str, key: str) -> None:
        parsed = urlsplit(url.strip().rstrip("/"))
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.query
            or parsed.fragment
            or parsed.path not in ("", "/rest/v1")
            or not key.strip()
        ):
            raise ReservationUnavailable
        self.rpc_url = f"https://{parsed.netloc}/rest/v1/rpc"
        self.key = key.strip()

    def _rpc(self, name: str, arguments: dict[str, object]) -> bytes:
        try:
            response = httpx.post(
                f"{self.rpc_url}/{name}",
                json=arguments,
                headers={"apikey": self.key, "Authorization": f"Bearer {self.key}"},
                timeout=10,
                follow_redirects=False,
            )
            response.raise_for_status()
            return response.content
        except httpx.HTTPStatusError as error:
            try:
                code = _RpcError.model_validate_json(error.response.content).code
            except ValidationError:
                code = ""
            if code == "23P01":
                raise ReservationConflict from None
            raise ReservationUnavailable from None
        except httpx.HTTPError, ValueError:
            raise ReservationUnavailable from None

    def conflicts(self, cells: list[str], start: datetime, end: datetime) -> list[Booking]:
        raw = self._rpc(
            "reservation_conflicts_complete",
            {"p_cell_ids": cells, "p_starts_at": start.isoformat(), "p_ends_at": end.isoformat()},
        )
        try:
            return _bookings.validate_json(raw)
        except ValidationError:
            raise ReservationUnavailable from None

    def authorize(self, token: str) -> bool | None:
        try:
            return _authorized.validate_json(
                self._rpc("reservation_operator_authorized", {"p_token": token}), strict=True
            )
        except ValidationError:
            raise ReservationUnavailable from None

    def list(self, limit: int = 100, offset: int = 0) -> list[Booking]:
        try:
            return _bookings.validate_json(
                self._rpc("reservation_list", {"p_limit": limit, "p_offset": offset})
            )
        except ValidationError:
            raise ReservationUnavailable from None

    def confirm(self, request: Registration) -> Booking:
        raw = self._rpc(
            "reservation_confirm",
            {
                "p_cell_ix": request.cell_ix,
                "p_cell_iy": request.cell_iy,
                "p_company": request.company,
                "p_mission_name": request.mission_name,
                "p_starts_at": request.starts_at.isoformat(),
                "p_ends_at": request.ends_at.isoformat(),
            },
        )
        try:
            rows = _bookings.validate_json(raw)
        except ValidationError:
            raise ReservationUnavailable from None
        if len(rows) != 1:
            raise ReservationUnavailable
        return rows[0]

    def cancel(self, booking_id: UUID) -> Booking | None:
        try:
            rows = _bookings.validate_json(
                self._rpc("reservation_cancel", {"p_booking_id": str(booking_id)})
            )
        except ValidationError:
            raise ReservationUnavailable from None
        if len(rows) > 1:
            raise ReservationUnavailable
        return rows[0] if rows else None
