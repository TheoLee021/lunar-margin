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
from lunar_margin.engine.ephemeris import body_azel, load_kernels, utc_range
from lunar_margin.engine.horizon import horizon_profile
from lunar_margin.engine.metrics import summarize, visibility_series
from lunar_margin.engine.site_characteristics import characterize_site
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

    @model_validator(mode="after")
    def check_times(self) -> Self:
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


class TerrainSummary(BaseModel):
    elevation_m: float
    slope_deg: float
    roughness_rms_m: float
    slope_baseline_m: float
    roughness_window_m: float
    dem_pixel_m: float
    limitation: str


class SiteAssessment(BaseModel):
    lat: float
    lon: float
    start: datetime
    end: datetime
    step_minutes: int
    sun: BodySummary
    earth: BodySummary
    terrain: TerrainSummary


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
        # Coarse screening: reduced DEM ray sampling limits concurrent API memory.
        # The existing detailed analysis keeps its higher-resolution settings.
        horizon = horizon_profile(dem, query.lat, query.lon, azimuth_step_deg=2.0, step_m=160.0)
        et = utc_range(query.start, query.end, query.step_minutes)

        def summary(body: str) -> BodySummary:
            azimuth, elevation = body_azel(
                "SUN" if body == "SUN" else "EARTH",
                query.lat,
                query.lon,
                et,
            )
            visible = visibility_series(horizon, azimuth, elevation)
            metrics = summarize(visible, query.step_minutes, elevation)
            return BodySummary(
                visible_fraction=round(metrics.visible_fraction, 4),
                longest_dark_hours=round(metrics.longest_dark_hours, 3),
                windows_per_24h=round(metrics.windows_per_24h, 4),
            )

        return SiteAssessment(
            lat=query.lat,
            lon=query.lon,
            start=query.start,
            end=query.end,
            step_minutes=query.step_minutes,
            sun=summary("SUN"),
            earth=summary("EARTH"),
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
