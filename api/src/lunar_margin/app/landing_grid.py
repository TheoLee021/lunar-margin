"""Local DEM landing-target grid endpoint (screening, NOT landing certification)."""

from collections.abc import Callable
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Self

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.settings import Settings
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.landing_grid import LandingGridResult, evaluate_landing_grid
from lunar_margin.pipeline.sources import DEM_SOURCES


class LandingGridQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=-80)
    lon: float = Field(ge=-360, le=360)
    assessment_radius_m: float = Field(default=250.0, ge=160, le=500)
    target_radius_m: float = Field(default=50.0, ge=20, le=100)
    max_slope_deg: float = Field(default=10.0, ge=0, le=90)
    max_roughness_m: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def ensure_target_inside(self) -> Self:
        if self.target_radius_m >= self.assessment_radius_m:
            raise ValueError("target radius must be smaller than assessment radius")
        return self


class CellModel(BaseModel):
    dx_m: float
    dy_m: float
    slope_deg: float | None
    roughness_rms_m: float | None
    valid: bool
    in_assessment_circle: bool


class TargetModel(BaseModel):
    dx_m: float
    dy_m: float
    lat_deg: float
    lon_deg: float
    cells_intersecting: int
    valid_cells: int
    coverage_fraction: float
    slope_p95_deg: float | None
    slope_max_deg: float | None
    roughness_max_m: float | None
    terrain_screen_pass: bool
    reasons: tuple[str, ...]


class LandingGridResponse(BaseModel):
    lat: float
    lon: float
    assessment_radius_m: float
    target_radius_m: float
    sample_step_m: float
    slope_baseline_m: float
    roughness_window_m: float
    max_slope_deg: float
    max_roughness_m: float | None
    total_target_centers: int
    passing_target_centers: int
    cells: tuple[CellModel, ...]
    targets: tuple[TargetModel, ...]
    best_target: TargetModel | None
    landing_safety_status: str
    limitation: str


GridEvaluator = Callable[[LandingGridQuery], LandingGridResponse]


@lru_cache(maxsize=2)
def _load_dem(data_dir: Path) -> PolarDem:
    img, lbl = DEM_SOURCES["80s_80m"]
    image = data_dir / "dem" / img.filename
    label = data_dir / "dem" / lbl.filename
    if not image.exists() or not label.exists():
        raise HTTPException(status_code=503, detail="LOLA DEM unavailable; run fetch pipeline")
    return PolarDem.from_files(image, label)


def get_grid_evaluator(settings: Annotated[Settings, Depends(get_settings)]) -> GridEvaluator:
    dem = _load_dem(settings.data_dir.resolve())

    def evaluate(query: LandingGridQuery) -> LandingGridResponse:
        result: LandingGridResult = evaluate_landing_grid(
            dem,
            query.lat,
            query.lon,
            assessment_radius_m=query.assessment_radius_m,
            target_radius_m=query.target_radius_m,
            max_slope_deg=query.max_slope_deg,
            max_roughness_m=query.max_roughness_m,
        )
        return LandingGridResponse.model_validate(
            {"lat": query.lat, "lon": query.lon, **asdict(result)}
        )

    return evaluate


router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.get("/landing-grid")
def landing_grid(
    query: Annotated[LandingGridQuery, Query()],
    evaluator: Annotated[GridEvaluator, Depends(get_grid_evaluator)],
) -> LandingGridResponse:
    try:
        return evaluator(query)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
