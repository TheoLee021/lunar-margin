"""PRELIMINARY terrain-aware lunar powered-descent reference screening API.

Not a flight-ready trajectory optimizer, not coupled to the dated transfer,
and not an operational landing safety certification.
"""

from datetime import timedelta
from threading import BoundedSemaphore
from typing import Annotated, Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, Field, model_validator

from lunar_margin.app.analysis import get_dem
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.descent_los import LosStatus, terrain_los
from lunar_margin.engine.descent_reference import (
    Lander,
    PathResult,
    evaluate_alternatives,
    pdi_from_target,
)
from lunar_margin.engine.ephemeris import body_vectors, utc_range

router = APIRouter(prefix="/trajectory", tags=["trajectory"])
_slots = BoundedSemaphore(2)


class SiteTarget(BaseModel):
    lat_deg: float = Field(ge=-90.0, le=-80.0, allow_inf_nan=False)
    lon_deg: float = Field(ge=-360.0, le=360.0, allow_inf_nan=False)


class VehicleRequest(BaseModel):
    wet_mass_kg: float = Field(default=1200.0, gt=0, allow_inf_nan=False)
    dry_mass_kg: float = Field(default=450.0, gt=0, allow_inf_nan=False)
    max_thrust_n: float = Field(default=15000.0, gt=0, allow_inf_nan=False)
    min_thrust_n: float = Field(default=0.0, ge=0, allow_inf_nan=False)
    isp_s: float = Field(default=310.0, gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def mass_and_thrust(self) -> VehicleRequest:
        if self.wet_mass_kg <= self.dry_mass_kg:
            raise ValueError("wet mass must exceed dry mass")
        if self.max_thrust_n <= self.min_thrust_n:
            raise ValueError("maximum thrust must exceed minimum")
        return self


def _empty_backup_sites() -> list[SiteTarget]:
    return []


class DescentRequest(BaseModel):
    epoch_utc: AwareDatetime
    primary_site: SiteTarget
    backup_sites: list[SiteTarget] = Field(default_factory=_empty_backup_sites, max_length=3)
    approach_azimuth_deg: float = Field(default=90.0, ge=0, lt=360, allow_inf_nan=False)
    approach_range_km: float = Field(default=300.0, gt=0, lt=600, allow_inf_nan=False)
    clearance_m: float = Field(default=50.0, ge=0, le=10000, allow_inf_nan=False)
    include_earth_los: bool = True
    vehicle: VehicleRequest = Field(default_factory=VehicleRequest)


class PdiSummary(BaseModel):
    altitude_reference_m: float
    velocity_mps: float
    doi_delta_v_mps: float
    doi_to_pdi_s: float
    position_moon_me_m: list[float]
    velocity_moon_me_mps: list[float]


class LandingSiteResult(BaseModel):
    site: SiteTarget
    path: PathResult
    earth_los_samples: list[LosStatus] | None = None
    earth_visible_sample_fraction: float | None = None
    earth_unknown_sample_fraction: float | None = None


class DescentResponse(BaseModel):
    model: Literal["REFERENCE_ONLY_NOT_FLIGHT_CERTIFIED"]
    note: str
    pdi: PdiSummary
    results: list[LandingSiteResult]


def _check_path(path: PathResult) -> None:
    if path.status == "REFERENCE_FEASIBLE" and path.min_clearance_m is None:
        raise ValueError("feasible profile must have valid terrain samples")


@router.post("/descent-reference")
def descent_reference(
    query: DescentRequest,
    dem: Annotated[PolarDem, Depends(get_dem)],
) -> DescentResponse:
    if not _slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Descent reference solver busy")
    try:
        initial = pdi_from_target(
            query.primary_site.lat_deg,
            query.primary_site.lon_deg,
            approach_azimuth_deg=query.approach_azimuth_deg,
            approach_range_km=query.approach_range_km,
        )
        vehicle = Lander(**query.vehicle.model_dump())
        targets = [query.primary_site, *query.backup_sites]
        paths = evaluate_alternatives(
            dem,
            initial,
            [(target.lat_deg, target.lon_deg) for target in targets],
            vehicle,
            clearance_m=query.clearance_m,
        )

        results: list[LandingSiteResult] = []
        epoch = query.epoch_utc
        for target, path in zip(targets, paths, strict=True):
            _check_path(path)
            los: list[LosStatus] | None = None
            visible_fraction: float | None = None
            unknown_fraction: float | None = None
            if query.include_earth_los and path.samples:
                et0 = float(utc_range(epoch, epoch + timedelta(minutes=1), 1)[0])
                offsets = np.array([sample.t_s for sample in path.samples], dtype=np.float64)
                earth_m = body_vectors("EARTH", et0 + offsets) * 1000.0
                los = [
                    terrain_los(
                        dem,
                        np.asarray(sample.moon_me_xyz_m, dtype=np.float64),
                        earth,
                    )
                    for sample, earth in zip(path.samples, earth_m, strict=True)
                ]
                visible_fraction = sum(value == "VISIBLE" for value in los) / len(los)
                unknown_fraction = sum(value == "UNKNOWN" for value in los) / len(los)
            results.append(
                LandingSiteResult(
                    site=target,
                    path=path,
                    earth_los_samples=los,
                    earth_visible_sample_fraction=visible_fraction,
                    earth_unknown_sample_fraction=unknown_fraction,
                )
            )

        radius = float(np.linalg.norm(initial.position_m))
        return DescentResponse(
            model="REFERENCE_ONLY_NOT_FLIGHT_CERTIFIED",
            note=(
                "Synthetic 100x15 km PDI reference with Moon-fixed constant spin. "
                "Profile-grid inverse dynamics: not an optimum, closed-loop guidance, "
                "or a validated transfer-to-landing handoff. No RF/relay link budget. "
                "No successful candidate means only no tested reference profile passed."
            ),
            pdi=PdiSummary(
                altitude_reference_m=radius - 1_737_400.0,
                velocity_mps=float(np.linalg.norm(initial.velocity_mps)),
                doi_delta_v_mps=initial.doi_delta_v_mps,
                doi_to_pdi_s=initial.doi_to_pdi_s,
                position_moon_me_m=initial.position_m.tolist(),
                velocity_moon_me_mps=initial.velocity_mps.tolist(),
            ),
            results=results,
        )
    except (ValueError, OverflowError, FloatingPointError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        _slots.release()
