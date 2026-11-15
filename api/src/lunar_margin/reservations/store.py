"""PostgreSQL이 예약 확정의 유일한 소유자다. 중복 제약은 프로세스 간에도 적용된다."""

from datetime import datetime
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import DictRow, dict_row

from lunar_margin.reservations.models import Booking, Registration


class Store:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    def _connect(self) -> psycopg.Connection[DictRow]:
        return psycopg.Connection[DictRow].connect(
            self.dsn, connect_timeout=5, row_factory=dict_row, options="-c statement_timeout=10000"
        )

    def confirm(self, request: Registration) -> Booking:
        with self._connect() as conn:
            # 동시 INSERT의 exclusion-check 교착을 피하려고 같은 셀만 직렬화한다.
            # DB 제약도 유지해 다른 writer/프로세스의 중복까지 막는다.
            conn.execute(
                "SELECT pg_advisory_xact_lock(500, (%s + 610) * 1221 + (%s + 610))",
                (request.cell_ix, request.cell_iy),
            )
            row = conn.execute(
                """INSERT INTO mission_reservations.bookings
                (id, cell_id, cell_ix, cell_iy, company, mission_name, starts_at, ends_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                (
                    uuid4(),
                    request.cell_id,
                    request.cell_ix,
                    request.cell_iy,
                    request.company,
                    request.mission_name,
                    request.starts_at,
                    request.ends_at,
                ),
            ).fetchone()
            return Booking.model_validate(row)

    def list(self, limit: int = 100, offset: int = 0) -> list[Booking]:
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT * FROM mission_reservations.bookings
                ORDER BY confirmed_at DESC, id LIMIT %s OFFSET %s""",
                (limit, offset),
            ).fetchall()
            return [Booking.model_validate(row) for row in rows]

    def cancel(self, booking_id: UUID) -> Booking | None:
        with self._connect() as conn:
            row = conn.execute(
                """UPDATE mission_reservations.bookings SET status='cancelled',
                cancelled_at=COALESCE(cancelled_at, clock_timestamp())
                WHERE id=%s RETURNING *""",
                (booking_id,),
            ).fetchone()
            return Booking.model_validate(row) if row else None

    def conflicts(self, cells: list[str], start: datetime, end: datetime) -> list[Booking]:
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT * FROM mission_reservations.bookings WHERE status='confirmed'
                AND cell_id = ANY(%s)
                AND tstzrange(starts_at, ends_at, '[)') && tstzrange(%s,%s,'[)')
                ORDER BY confirmed_at, id""",
                (cells, start, end),
            ).fetchall()
            return [Booking.model_validate(row) for row in rows]
