"""GET /analysis/illumination, /earth-visibility, /site-assessment (계약: docs/api.md)."""

import math
from collections.abc import Callable
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal, Self

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from numpy.typing import NDArray
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from lunar_margin.app.settings import Settings
from lunar_margin.engine.clearance import terrain_clearance_diagnostics
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.ephemeris import load_kernels
from lunar_margin.engine.metrics import SiteAnalysis, VisibilityMetrics, analyze_site, find_runs
from lunar_margin.engine.site_characteristics import characterize_region
from lunar_margin.pipeline.candidate_schema import TerrainMetrics
from lunar_margin.pipeline.sources import DEM_SOURCES

Kind = Literal["SUN", "EARTH"]
MAX_SPAN = timedelta(days=366 * 3)
MAX_SAMPLES = 100_000


class AnalysisQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lat: float = Field(ge=-90.0, le=-80.0)
    lon: float = Field(ge=-360.0, le=360.0)
    start: AwareDatetime
    end: AwareDatetime
    step_minutes: int = Field(default=30, ge=5, le=360)
    observer_height_m: float = Field(default=0.0, ge=0.0, le=100.0)

    @model_validator(mode="after")
    def _check_range(self) -> Self:
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if self.end - self.start > MAX_SPAN:
            raise ValueError("the range must not exceed 3 years")
        samples = math.ceil((self.end - self.start).total_seconds() / (self.step_minutes * 60))
        if samples > MAX_SAMPLES:
            raise ValueError(f"too many samples ({samples} > {MAX_SAMPLES}); raise step_minutes")
        return self


class Metrics(BaseModel):
    visible_fraction: float
    longest_dark_hours: float
    windows_per_24h: float
    mean_elevation_deg: float | None


class Horizon(BaseModel):
    azimuth_deg: list[float]
    elevation_deg: list[float]


class Series(BaseModel):
    terrain_clearance_deg: list[float]
    times: list[str]
    body_azimuth_deg: list[float]
    body_elevation_deg: list[float]
    visible: list[bool]


class Period(BaseModel):
    start: str
    end: str


class AnalysisResponse(BaseModel):
    lat: float
    lon: float
    start: str
    end: str
    step_minutes: int
    observer_height_m: float
    metrics: Metrics
    horizon: Horizon
    series: Series
    windows: list[Period]
    dark_periods: list[Period]
    visible_clearance_p10_deg: float | None


class SiteAssessment(BaseModel):
    """후보 비교용 요약. 시계열 없이 일조·지구 지표와 250 m 지역 지형만 담는다."""

    lat: float
    lon: float
    start: str
    end: str
    step_minutes: int
    observer_height_m: float
    sun: Metrics
    earth: Metrics
    terrain: TerrainMetrics


Analyzer = Callable[[Kind, AnalysisQuery], SiteAnalysis]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


@lru_cache(maxsize=2)
def _load_dem(data_dir: Path) -> PolarDem:
    """DEM과 SPICE 커널을 처음 요청 때 한 번 로드한다. 데이터가 없으면 503."""
    img_source, lbl_source = DEM_SOURCES["80s_80m"]
    img = data_dir / "dem" / img_source.filename
    lbl = data_dir / "dem" / lbl_source.filename
    if not img.exists() or not lbl.exists() or not (data_dir / "spice").is_dir():
        raise HTTPException(
            status_code=503,
            detail="NASA data not found; run `uv run python -m lunar_margin.pipeline.fetch`",
        )
    try:
        load_kernels(data_dir / "spice")
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=f"{error}") from error
    return PolarDem.from_files(img, lbl)


@lru_cache(maxsize=2)
def _build_analyzer(data_dir: Path) -> Analyzer:
    dem = _load_dem(data_dir)

    def analyze(kind: Kind, query: AnalysisQuery) -> SiteAnalysis:
        return analyze_site(
            dem,
            query.lat,
            query.lon,
            kind,
            query.start,
            query.end,
            query.step_minutes,
            query.observer_height_m,
        )

    return analyze


def get_analyzer(settings: Annotated[Settings, Depends(get_settings)]) -> Analyzer:
    return _build_analyzer(settings.data_dir)


def get_dem(settings: Annotated[Settings, Depends(get_settings)]) -> PolarDem:
    return _load_dem(settings.data_dir)


def _utc(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _round(values: NDArray[np.float64]) -> list[float]:
    return [round(float(v), 3) for v in values]


def _periods(analysis: SiteAnalysis, value: bool) -> list[Period]:
    step = timedelta(minutes=analysis.step_minutes)
    return [
        Period(start=_utc(analysis.times[a]), end=_utc(analysis.times[a] + step * (b - a)))
        for a, b in find_runs(analysis.visible, value)
    ]


def _metrics(metrics: VisibilityMetrics) -> Metrics:
    return Metrics(
        visible_fraction=round(metrics.visible_fraction, 4),
        longest_dark_hours=round(metrics.longest_dark_hours, 3),
        windows_per_24h=round(metrics.windows_per_24h, 4),
        mean_elevation_deg=None
        if metrics.mean_elevation_deg is None
        else round(metrics.mean_elevation_deg, 3),
    )


def _respond(kind: Kind, query: AnalysisQuery, analyzer: Analyzer) -> AnalysisResponse:
    try:
        analysis = analyzer(kind, query)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    diagnostics = terrain_clearance_diagnostics(
        analysis.horizon, analysis.body_azimuth_deg, analysis.body_elevation_deg
    )
    return AnalysisResponse(
        lat=query.lat,
        lon=query.lon,
        start=_utc(query.start),
        end=_utc(query.end),
        step_minutes=query.step_minutes,
        observer_height_m=query.observer_height_m,
        metrics=_metrics(analysis.metrics),
        horizon=Horizon(
            azimuth_deg=_round(analysis.horizon.azimuth_deg),
            elevation_deg=_round(analysis.horizon.elevation_deg),
        ),
        series=Series(
            terrain_clearance_deg=_round(diagnostics.clearance_deg),
            times=[_utc(t) for t in analysis.times],
            body_azimuth_deg=_round(analysis.body_azimuth_deg),
            body_elevation_deg=_round(analysis.body_elevation_deg),
            visible=[bool(v) for v in analysis.visible],
        ),
        windows=_periods(analysis, True),
        dark_periods=_periods(analysis, False),
        visible_clearance_p10_deg=(
            None
            if diagnostics.visible_clearance_p10_deg is None
            else round(diagnostics.visible_clearance_p10_deg, 3)
        ),
    )


router = APIRouter(prefix="/analysis", tags=["analysis"])

AnalyzerDep = Annotated[Analyzer, Depends(get_analyzer)]
QueryDep = Annotated[AnalysisQuery, Query()]


@router.get("/illumination")
def illumination(query: QueryDep, analyzer: AnalyzerDep) -> AnalysisResponse:
    return _respond("SUN", query, analyzer)


@router.get("/earth-visibility")
def earth_visibility(query: QueryDep, analyzer: AnalyzerDep) -> AnalysisResponse:
    return _respond("EARTH", query, analyzer)


@router.get("/site-assessment")
def site_assessment(
    query: QueryDep, analyzer: AnalyzerDep, dem: Annotated[PolarDem, Depends(get_dem)]
) -> SiteAssessment:
    """위 두 분석과 같은 계산의 지표에 후보 탐색과 같은 250 m 지역 경사를 붙인다."""
    try:
        sun = analyzer("SUN", query)
        earth = analyzer("EARTH", query)
        region = characterize_region(dem, query.lat, query.lon)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return SiteAssessment(
        lat=query.lat,
        lon=query.lon,
        start=_utc(query.start),
        end=_utc(query.end),
        step_minutes=query.step_minutes,
        observer_height_m=query.observer_height_m,
        sun=_metrics(sun.metrics),
        earth=_metrics(earth.metrics),
        terrain=TerrainMetrics(
            slope_p95_deg=None if region.slope_p95_deg is None else round(region.slope_p95_deg, 3),
            coverage_fraction=round(region.coverage_fraction, 4),
            dem_pixel_m=float(dem.label.map_scale_m),
        ),
    )
