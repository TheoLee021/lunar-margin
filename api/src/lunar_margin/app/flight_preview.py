"""End-to-end REFERENCE preview: dated transfer -> LOI -> DOI -> PDI -> descent.

The descent is evaluated only when the nominal orbit reference is aligned with
the chosen landing target. An illustrative customer payload is not a lander.
"""
import math
from dataclasses import dataclass
from datetime import timedelta
from threading import BoundedSemaphore
from typing import Annotated, Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from lunar_margin.app.analysis import get_dem
from lunar_margin.app.settings import Settings
from lunar_margin.app.trajectory import trajectory_settings
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.descent_reference import (
    Lander,
    PathResult,
    PdiState,
    evaluate_reference,
    surface_vector,
)
from lunar_margin.engine.doi_pdi_reference import DoiPdiReference, reference_doi_pdi
from lunar_margin.engine.ephemeris import inertial_moon_state_to_moon_me
from lunar_margin.engine.transfer import calculate_transfer

router = APIRouter(prefix="/trajectory", tags=["trajectory"])
_slots = BoundedSemaphore(1)


class FlightPreviewQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    departure: AwareDatetime
    arrival: AwareDatetime
    latitude: float = Field(ge=-90, le=-80, allow_inf_nan=False)
    longitude: float = Field(ge=-360, le=360, allow_inf_nan=False)
    alignment_tolerance_m: float = Field(default=5000, gt=0, le=100000)
    duration_s: float = Field(default=720, ge=300, le=1500)
    loft_m: float = Field(default=0, ge=0, le=10000)
    wet_mass_kg: float = Field(default=1200, gt=0, allow_inf_nan=False)
    dry_mass_kg: float = Field(default=450, gt=0, allow_inf_nan=False)
    max_thrust_n: float = Field(default=15000, gt=0, allow_inf_nan=False)
    min_thrust_n: float = Field(default=0, ge=0, allow_inf_nan=False)
    isp_s: float = Field(default=310, gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_mission(self) -> "FlightPreviewQuery":
        if not 86400 <= (self.arrival - self.departure).total_seconds() <= 864000:
            raise ValueError("transfer duration must be 1-10 days")
        if not (1900 <= self.departure.year <= 2100 and 1900 <= self.arrival.year <= 2100):
            raise ValueError("supported calendar range is 1900-2100")
        if self.wet_mass_kg <= self.dry_mass_kg:
            raise ValueError("PDI wet mass must exceed dry mass")
        if self.max_thrust_n <= self.min_thrust_n:
            raise ValueError("thrust maximum must exceed minimum")
        return self


@dataclass(frozen=True)
class FlightPreviewResponse:
    model: Literal["REFERENCE_ONLY_NOT_FLIGHT_CERTIFIED"]
    status: Literal["NO_PDI_REFERENCE", "DESCENT_REFERENCE_PASSED", "DESCENT_REFERENCE_FAILED"]
    note: str
    target_latitude: float
    target_longitude: float
    orbit: DoiPdiReference
    descent_epoch_utc: str | None
    descent: PathResult | None


@router.post("/flight-preview", response_model=FlightPreviewResponse)
def flight_preview(
    query: FlightPreviewQuery,
    settings: Annotated[Settings, Depends(trajectory_settings)],
    dem: Annotated[PolarDem, Depends(get_dem)],
) -> FlightPreviewResponse:
    if not _slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Reference flight computation busy")
    try:
        transfer = calculate_transfer(query.departure, query.arrival, settings.data_dir)
        handoff = transfer.loi_handoff
        post_loi = np.asarray(handoff.post_loi_j2000_km_kmps, dtype=np.float64) * 1000
        orbit = reference_doi_pdi(
            post_loi,
            handoff.epoch_utc,
            query.latitude,
            query.longitude,
            inertial_moon_state_to_moon_me,
            tolerance_m=query.alignment_tolerance_m,
        )
        if orbit.aligned_pdi_moon_me_m_mps is None:
            return FlightPreviewResponse(
                "REFERENCE_ONLY_NOT_FLIGHT_CERTIFIED",
                "NO_PDI_REFERENCE",
                "No tested DOI phase met the specified target-alignment tolerance. "
                "No powered descent is fabricated.",
                query.latitude,
                query.longitude,
                orbit,
                None,
                None,
            )

        # Use the SAME 6D PDI state from the orbit reference; never reconstruct
        # a synthetic PDI from the selected target or an approach-heading slider.
        pdi = np.asarray(orbit.aligned_pdi_moon_me_m_mps, dtype=np.float64)
        up = surface_vector(query.latitude, query.longitude)
        cos_angle = float(np.clip(np.dot(pdi[:3] / np.linalg.norm(pdi[:3]), up), -1, 1))
        approach_range_km = 1737.4 * math.acos(cos_angle)
        state = PdiState(
            position_m=pdi[:3],
            velocity_mps=pdi[3:],
            doi_delta_v_mps=orbit.doi_delta_v_mps,
            doi_to_pdi_s=orbit.coast_time_s,
            approach_range_km=approach_range_km,
        )
        vehicle = Lander(
            wet_mass_kg=query.wet_mass_kg,
            dry_mass_kg=query.dry_mass_kg,
            max_thrust_n=query.max_thrust_n,
            min_thrust_n=query.min_thrust_n,
            isp_s=query.isp_s,
        )
        path = evaluate_reference(
            dem,
            state,
            query.latitude,
            query.longitude,
            vehicle,
            duration_s=query.duration_s,
            loft_m=query.loft_m,
        )
        return FlightPreviewResponse(
            "REFERENCE_ONLY_NOT_FLIGHT_CERTIFIED",
            "DESCENT_REFERENCE_PASSED"
            if path.status == "REFERENCE_FEASIBLE"
            else "DESCENT_REFERENCE_FAILED",
            "PDI state comes from the orbital reference. Descent uses approximate "
            "constant lunar spin and prescribed polynomial inverse dynamics; "
            "no flight guidance, vehicle certification, or payload availability. "
            "Vehicle wet mass is specified AT PDI; DOI propellant is not deducted.",
            query.latitude,
            query.longitude,
            orbit,
            (orbit.pdi.epoch_utc + timedelta(seconds=0)).isoformat(),
            path,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Required NASA SPICE/DEM data missing") from exc
    except (ValueError, OverflowError, FloatingPointError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        _slots.release()
