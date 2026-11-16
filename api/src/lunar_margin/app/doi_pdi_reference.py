"""Dated transfer -> physical LOI -> site-screened DOI/PDI reference.

No synthetic launch-provider payload or flight-certified landing performance.
"""
from threading import BoundedSemaphore
from typing import Annotated

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, Field, model_validator

from lunar_margin.app.settings import Settings
from lunar_margin.app.trajectory import trajectory_settings
from lunar_margin.engine.doi_pdi_reference import DoiPdiReference, reference_doi_pdi
from lunar_margin.engine.ephemeris import inertial_moon_state_to_moon_me
from lunar_margin.engine.transfer import calculate_transfer

router = APIRouter(prefix="/trajectory", tags=["trajectory"])
_slots = BoundedSemaphore(1)


class LandingReferenceRequest(BaseModel):
    departure: AwareDatetime
    arrival: AwareDatetime
    target_lat_deg: float = Field(ge=-90.0, le=-80.0, allow_inf_nan=False)
    target_lon_deg: float = Field(ge=-360.0, le=360.0, allow_inf_nan=False)
    pdi_altitude_m: float = Field(default=15_000.0, gt=0, lt=100_000, allow_inf_nan=False)
    alignment_tolerance_m: float = Field(default=5_000.0, gt=0, le=100_000, allow_inf_nan=False)

    @model_validator(mode="after")
    def check_interval(self) -> "LandingReferenceRequest":
        seconds = (self.arrival - self.departure).total_seconds()
        if not 86400 <= seconds <= 864000:
            raise ValueError("transfer time must be 1 to 10 days")
        if not (
            1900 <= self.departure.year <= 2100
            and 1900 <= self.arrival.year <= 2100
        ):
            raise ValueError("dates outside supported ephemeris range")
        return self


@router.post("/doi-pdi-reference", response_model=DoiPdiReference)
def doi_pdi_reference(
    request: LandingReferenceRequest,
    settings: Annotated[Settings, Depends(trajectory_settings)],
) -> DoiPdiReference:
    if not _slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Orbital bridge busy")
    try:
        transfer = calculate_transfer(request.departure, request.arrival, settings.data_dir)
        handoff = transfer.loi_handoff
        state = np.asarray(handoff.post_loi_j2000_km_kmps, dtype=np.float64) * 1000.0
        return reference_doi_pdi(
            state,
            handoff.epoch_utc,
            request.target_lat_deg,
            request.target_lon_deg,
            inertial_moon_state_to_moon_me,
            pdi_altitude_m=request.pdi_altitude_m,
            tolerance_m=request.alignment_tolerance_m,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail="SPICE data missing") from error
    except (ValueError, OverflowError, FloatingPointError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        _slots.release()
