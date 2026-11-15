"""NASA-data candidate assessment: terrain, Sun and Earth over the same UTC period.

This route shares a single LOLA horizon profile between both visibility
analyses. All outcomes are geometric/DEM-scale screening, NOT a certified
landing hazard assessment, power model or actual RF link budget.
"""

from collections.abc import Callable
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Self

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.settings import Settings
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.access_diagnostics import (
    RFConfig,
    access_diagnostics,
    nominal_rf_diagnostics,
    target_range_km,
)
from lunar_margin.engine.ephemeris import body_azel, body_vectors, load_kernels, utc_range
from lunar_margin.engine.horizon import horizon_profile
from lunar_margin.engine.metrics import summarize, visibility_series
from lunar_margin.engine.site_characteristics import characterize_region, characterize_site
from lunar_margin.pipeline.sources import DEM_SOURCES


class SiteQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90.0, le=-80.0)
    lon: float = Field(ge=-360.0, le=360.0)
    start: AwareDatetime
    end: AwareDatetime
    step_minutes: int = Field(default=30, ge=5, le=360)
    slope_baseline_m: float = Field(default=160.0, ge=80.0, le=2000.0)
    roughness_window_m: float = Field(default=400.0, ge=160.0, le=2000.0)
    assessment_radius_m: float = Field(default=250.0, ge=80.0, le=2000.0)
    # Nominal RF is optional. All assumptions must be explicit; never silently use defaults.
    rf_frequency_hz: float | None = Field(default=None, gt=0)
    rf_tx_power_w: float | None = Field(default=None, gt=0)
    rf_tx_gain_dbi: float | None = None
    rf_rx_gain_dbi: float | None = None
    rf_misc_loss_db: float | None = Field(default=None, ge=0)
    rf_rx_required_dbm: float | None = None
    rf_target_margin_db: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_times(self) -> Self:
        rf_params = (
            self.rf_frequency_hz,
            self.rf_tx_power_w,
            self.rf_tx_gain_dbi,
            self.rf_rx_gain_dbi,
            self.rf_misc_loss_db,
            self.rf_rx_required_dbm,
            self.rf_target_margin_db,
        )
        if any(value is not None for value in rf_params) and not all(
            value is not None for value in rf_params
        ):
            raise ValueError("all seven RF configuration fields are required together")
        if self.end <= self.start:
            raise ValueError("end must follow start")
        if self.end - self.start > timedelta(days=28):
            raise ValueError("candidate assessment spans at most 28 days")
        if (self.end - self.start).total_seconds() / (60 * self.step_minutes) > 2000:
            raise ValueError("too many time samples")
        return self


class BodySummary(BaseModel):
    visible_fraction: float
    longest_dark_hours: float
    windows_per_24h: float
    longest_visible_hours: float | None = None
    transitions: int | None = None
    clearance_p10_deg: float | None = None


class NominalRFResult(BaseModel):
    available_fraction: float
    longest_unavailable_hours: float
    min_visible_margin_db: float | None
    earth_range_min_km: float
    earth_range_max_km: float
    limitation: str = (
        "Nominal free-space link budget with user-supplied RF assumptions; "
        "NOT validated DTE performance, station visibility or guaranteed throughput"
    )


class TerrainSummary(BaseModel):
    elevation_m: float
    slope_deg: float
    roughness_rms_m: float
    slope_baseline_m: float
    roughness_window_m: float
    dem_pixel_m: float
    limitation: str


class RegionSummary(BaseModel):
    radius_m: float
    sample_step_m: float
    total_samples: int
    valid_samples: int
    coverage_fraction: float
    slope_p95_deg: float | None
    slope_max_deg: float | None
    roughness_p95_m: float | None
    landing_safety_status: str


class SiteAssessment(BaseModel):
    lat: float
    lon: float
    start: datetime
    end: datetime
    step_minutes: int
    sun: BodySummary
    earth: BodySummary
    terrain: TerrainSummary
    region: RegionSummary
    nominal_rf: NominalRFResult | None = None


Assessor = Callable[[SiteQuery], SiteAssessment]


@lru_cache(maxsize=2)
def _load_dem(data_dir: Path) -> PolarDem:
    img_source, lbl_source = DEM_SOURCES["80s_80m"]
    img = data_dir / "dem" / img_source.filename
    lbl = data_dir / "dem" / lbl_source.filename
    if not img.exists() or not lbl.exists() or not (data_dir / "spice").is_dir():
        raise HTTPException(
            status_code=503,
            detail="NASA data not found; run uv run python -m lunar_margin.pipeline.fetch",
        )
    try:
        load_kernels(data_dir / "spice")
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return PolarDem.from_files(img, lbl)


def get_site_assessor(settings: Annotated[Settings, Depends(get_settings)]) -> Assessor:
    dem = _load_dem(settings.data_dir.resolve())

    def assessor(query: SiteQuery) -> SiteAssessment:
        # DEM-scale terrain proxy; no subpixel touchdown hazard claims.
        terrain = characterize_site(
            dem,
            query.lat,
            query.lon,
            slope_baseline_m=query.slope_baseline_m,
            roughness_window_m=query.roughness_window_m,
        )
        region = characterize_region(
            dem,
            query.lat,
            query.lon,
            radius_m=query.assessment_radius_m,
            slope_baseline_m=query.slope_baseline_m,
            roughness_window_m=query.roughness_window_m,
        )
        # Coarse screening: reduced DEM ray sampling limits concurrent API memory.
        # The existing detailed analysis keeps its higher-resolution settings.
        horizon = horizon_profile(dem, query.lat, query.lon, azimuth_step_deg=2.0, step_m=160.0)
        et = utc_range(query.start, query.end, query.step_minutes)

        earth_visible = None

        def summary(body: str) -> BodySummary:
            nonlocal earth_visible
            azimuth, elevation = body_azel(
                "SUN" if body == "SUN" else "EARTH",
                query.lat,
                query.lon,
                et,
            )
            visible = visibility_series(horizon, azimuth, elevation)
            metrics = summarize(visible, query.step_minutes, elevation)
            diagnostics = access_diagnostics(
                horizon, azimuth, elevation, visible, query.step_minutes
            )
            if body == "EARTH":
                earth_visible = visible
            return BodySummary(
                visible_fraction=round(metrics.visible_fraction, 4),
                longest_dark_hours=round(metrics.longest_dark_hours, 3),
                windows_per_24h=round(metrics.windows_per_24h, 4),
                longest_visible_hours=round(diagnostics.longest_visible_hours, 3),
                transitions=diagnostics.transitions,
                clearance_p10_deg=(
                    round(diagnostics.clearance_p10_deg, 3)
                    if diagnostics.clearance_p10_deg is not None
                    else None
                ),
            )

        sun = summary("SUN")
        earth = summary("EARTH")
        nominal_rf = None
        if query.rf_frequency_hz is not None:
            assert earth_visible is not None
            assert query.rf_tx_power_w is not None
            assert query.rf_tx_gain_dbi is not None
            assert query.rf_rx_gain_dbi is not None
            assert query.rf_misc_loss_db is not None
            assert query.rf_rx_required_dbm is not None
            assert query.rf_target_margin_db is not None
            vectors = body_vectors("EARTH", et)
            distances = target_range_km(vectors, query.lat, query.lon)
            rf = nominal_rf_diagnostics(
                distances,
                earth_visible,
                query.step_minutes,
                RFConfig(
                    frequency_hz=query.rf_frequency_hz,
                    tx_power_w=query.rf_tx_power_w,
                    tx_gain_dbi=query.rf_tx_gain_dbi,
                    rx_gain_dbi=query.rf_rx_gain_dbi,
                    misc_loss_db=query.rf_misc_loss_db,
                    rx_required_dbm=query.rf_rx_required_dbm,
                    target_margin_db=query.rf_target_margin_db,
                ),
            )
            nominal_rf = NominalRFResult(
                available_fraction=round(rf.available_fraction, 4),
                longest_unavailable_hours=round(rf.longest_unavailable_hours, 3),
                min_visible_margin_db=(
                    round(rf.min_visible_margin_db, 3)
                    if rf.min_visible_margin_db is not None
                    else None
                ),
                earth_range_min_km=round(float(distances.min()), 2),
                earth_range_max_km=round(float(distances.max()), 2),
            )

        return SiteAssessment(
            lat=query.lat,
            lon=query.lon,
            start=query.start,
            end=query.end,
            step_minutes=query.step_minutes,
            sun=sun,
            earth=earth,
            nominal_rf=nominal_rf,
            region=RegionSummary(
                radius_m=region.radius_m,
                sample_step_m=region.sample_step_m,
                total_samples=region.total_samples,
                valid_samples=region.valid_samples,
                coverage_fraction=round(region.coverage_fraction, 4),
                slope_p95_deg=(
                    round(region.slope_p95_deg, 3) if region.slope_p95_deg is not None else None
                ),
                slope_max_deg=(
                    round(region.slope_max_deg, 3) if region.slope_max_deg is not None else None
                ),
                roughness_p95_m=(
                    round(region.roughness_p95_m, 3) if region.roughness_p95_m is not None else None
                ),
                landing_safety_status="UNVERIFIED",
            ),
            terrain=TerrainSummary(
                elevation_m=round(terrain.elevation_m, 2),
                slope_deg=round(terrain.slope_deg, 3),
                roughness_rms_m=round(terrain.roughness_rms_m, 3),
                slope_baseline_m=terrain.slope_baseline_m,
                roughness_window_m=terrain.roughness_window_m,
                dem_pixel_m=float(dem.label.map_scale_m),
                limitation=(
                    "DEM-scale terrain proxy; NOT boulder, footpad or landing-hazard clearance"
                ),
            ),
        )

    return assessor


router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.get("/site-assessment")
def site_assessment(
    query: Annotated[SiteQuery, Query()],
    assessor: Annotated[Assessor, Depends(get_site_assessor)],
) -> SiteAssessment:
    try:
        return assessor(query)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
