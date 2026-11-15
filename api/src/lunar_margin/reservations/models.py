"""고정 500m 격자와 UTC 예약 계약. 탐색 해상도/순위와 독립적이다."""

import math
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

CAP_RADIUS_M = 2 * 1_737_400 * math.tan(math.radians(5))


class Cell(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    cell_ix: int = Field(ge=-610, le=610, strict=True)
    cell_iy: int = Field(ge=-610, le=610, strict=True)

    @model_validator(mode="after")
    def south_pole(self) -> Self:
        # 위도 -80° 이남을 덮는 격자 (경계와 교차하는 셀 포함).
        nearest_x = max(abs(self.cell_ix) * 500 - 250, 0)
        nearest_y = max(abs(self.cell_iy) * 500 - 250, 0)
        if math.hypot(nearest_x, nearest_y) > CAP_RADIUS_M:
            raise ValueError("cell must intersect the lunar south polar cap (-90 to -80 degrees)")
        return self

    @property
    def cell_id(self) -> str:
        return f"SP500v1:{self.cell_ix}:{self.cell_iy}"


def cell_for_point(x_m: float, y_m: float) -> Cell:
    """MOON_ME 남극 입체투영. 셀 중심은 500m 배수, 경계는 [중심-250, 중심+250)."""
    return Cell(cell_ix=math.floor((x_m + 250) / 500), cell_iy=math.floor((y_m + 250) / 500))


class Registration(Cell):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, frozen=True)
    company: str = Field(min_length=1, max_length=120)
    mission_name: str = Field(min_length=1, max_length=120)
    landing_date: date
    mission_duration_days: int = Field(ge=1, le=365, strict=True)

    @model_validator(mode="after")
    def valid_period(self) -> Self:
        if not date(1850, 1, 1) <= self.landing_date < date(2150, 1, 1):
            raise ValueError("landing date must be inside 1850-2149")
        if self.ends_at > datetime(2150, 1, 1, tzinfo=UTC):
            raise ValueError("mission must end by 2150-01-01 UTC")
        return self

    @property
    def starts_at(self) -> datetime:
        return datetime.combine(self.landing_date, time.min, tzinfo=UTC)

    @property
    def ends_at(self) -> datetime:
        return self.starts_at + timedelta(days=self.mission_duration_days)


class Booking(BaseModel):
    id: UUID
    cell_id: str
    cell_ix: int
    cell_iy: int
    company: str
    mission_name: str
    starts_at: datetime
    ends_at: datetime
    confirmed_at: datetime
    status: Literal["confirmed", "cancelled"]
    cancelled_at: datetime | None


class BookingList(BaseModel):
    reservations: list[Booking]


class CandidateAvailability(BaseModel):
    candidate_id: str
    cell_id: str
    cell_ix: int
    cell_iy: int
    status: Literal["available", "reserved"]
    available_rank: int | None
    conflicts: list[Booking]


class Availability(BaseModel):
    run_id: str
    checked_at: datetime
    starts_at: datetime
    ends_at: datetime
    candidates: list[CandidateAvailability]
