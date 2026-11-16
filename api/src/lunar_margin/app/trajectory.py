"""Date-targeted Earth-Moon trajectory preview (independent of surface analysis)."""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, timedelta
from threading import BoundedSemaphore
from typing import Annotated, Self, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from lunar_margin.app.settings import Settings
from lunar_margin.engine.transfer import LandingApproach, TransferResult, calculate_transfer

router = APIRouter(prefix="/trajectory", tags=["trajectory"])
_slots = BoundedSemaphore(2)


class TransferQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    departure: AwareDatetime
    arrival: AwareDatetime

    @model_validator(mode="after")
    def check_interval(self) -> Self:
        self.departure = self.departure.astimezone(UTC)
        self.arrival = self.arrival.astimezone(UTC)
        if not timedelta(days=1) <= self.arrival - self.departure <= timedelta(days=10):
            raise ValueError("flight time must be between 1 and 10 days")
        if not (1900 <= self.departure.year <= 2100 and 1900 <= self.arrival.year <= 2100):
            raise ValueError("dates must be between 1900 and 2100")
        return self


class CaptureQuery(TransferQuery):
    latitude: float | None = Field(default=None, ge=-90, le=-80)
    longitude: float | None = Field(default=None, ge=-360, le=360)
    duration_s: float = Field(default=720, ge=300, le=1500)

    @model_validator(mode="after")
    def check_site(self) -> Self:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("both landing coordinates are required")
        return self


def trajectory_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


@contextmanager
def transfer_slot() -> Generator[None]:
    if not _slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Trajectory solver busy; retry shortly")
    try:
        yield
    finally:
        _slots.release()


@router.get("/transfer")
def transfer(
    query: Annotated[CaptureQuery, Query()],
    settings: Annotated[Settings, Depends(trajectory_settings)],
) -> TransferResult:
    try:
        with transfer_slot():
            approach = None
            if query.latitude is not None and query.longitude is not None:
                approach = LandingApproach(query.latitude, query.longitude, query.duration_s)
            return calculate_transfer(
                query.departure, query.arrival, settings.data_dir, landing_approach=approach
            )
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=503, detail="SPICE data missing; run the fetch pipeline"
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
