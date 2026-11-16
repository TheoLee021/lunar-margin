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
from lunar_margin.engine.solar_continuity import summarize_solar_continuity
from lunar_margin.pipeline.candidate_schema import TerrainMetrics
from lunar_margin.pipeline.sources import DEM_SOURCES

Kind = Literal["SUN", "EARTH"]
MAX_SPAN = timedelta(days=366 * 3)
MAX_SAMPLES = 100_000


class SampledRange(BaseModel):
    """[start, end)를 step_minutes 간격으로 나눈 표본 시각들. 쿼리 모델이 물려받아 쓴다."""

    model_config = ConfigDict(extra="forbid")

    start: AwareDatetime
    end: AwareDatetime
    step_minutes: int = Field(default=30, ge=5, le=360)

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


class AnalysisQuery(SampledRange):
    lat: float = Field(ge=-90.0, le=-80.0)
    lon: float = Field(ge=-360.0, le=360.0)
    observer_height_m: float = Field(default=0.0, ge=0.0, le=100.0)


class Metrics(BaseModel):
    visible_fraction: float
    longest_dark_hours: float
    windows_per_24h: float
    mean_elevation_deg: float | None


class Horizon(BaseModel):
    azimuth_deg: list[float]
    elevation_deg: list[float]


class Series(BaseModel):
    terrain_clearance_deg: list[float] | None = None
    times: list[str]
    body_azimuth_deg: list[float]
    body_elevation_deg: list[float]
    visible: list[bool]


class Period(BaseModel):
    start: str
    end: str


class AnalysisResponse(BaseModel):
    visible_clearance_p10_deg: float | None = None
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


class SolarContinuityMetrics(BaseModel):
    longest_sun_visible_hours: float
    visibility_transitions: int


class TerrainClearanceMetrics(BaseModel):
    sun_visible_p10_deg: float | None
    earth_visible_p10_deg: float | None


class SiteAssessment(BaseModel):
    """후보 비교용 요약. 시계열 없이 일조·지구 지표와 250 m 지역 지형만 담는다."""

    lat: float
    lon: float
    start: str
    end: str
    step_minutes: int
    observer_height_m: float
    terrain_clearance: TerrainClearanceMetrics | None = None
    solar_continuity: SolarContinuityMetrics | None = None
    sun: Metrics
    earth: Metrics
    terrain: TerrainMetrics


Analyzer = Callable[[Kind, AnalysisQuery], SiteAnalysis]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


@lru_cache(maxsize=2)
def load_analysis_dem(data_dir: Path, dem_name: str = "80s_80m") -> PolarDem:
    """DEM과 SPICE 커널을 처음 요청 때 한 번 로드한다. 데이터가 없으면 503."""
    if dem_name not in DEM_SOURCES:
        raise HTTPException(status_code=422, detail="unknown DEM")
    img_source, lbl_source = DEM_SOURCES[dem_name]
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
    dem = load_analysis_dem(data_dir)

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
    return load_analysis_dem(settings.data_dir)


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
        clearance = terrain_clearance_diagnostics(
            analysis.horizon,
            analysis.body_azimuth_deg,
            analysis.body_elevation_deg,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return AnalysisResponse(
        visible_clearance_p10_deg=clearance.visible_clearance_p10_deg,
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
            terrain_clearance_deg=clearance.clearance_deg.tolist(),
            times=[_utc(t) for t in analysis.times],
            body_azimuth_deg=_round(analysis.body_azimuth_deg),
            body_elevation_deg=_round(analysis.body_elevation_deg),
            visible=[bool(v) for v in analysis.visible],
        ),
        windows=_periods(analysis, True),
        dark_periods=_periods(analysis, False),
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
        sun_clearance = terrain_clearance_diagnostics(
            sun.horizon,
            sun.body_azimuth_deg,
            sun.body_elevation_deg,
        )
        earth_clearance = terrain_clearance_diagnostics(
            earth.horizon,
            earth.body_azimuth_deg,
            earth.body_elevation_deg,
        )
        continuity = summarize_solar_continuity(
            sun.visible,
            sun.step_minutes,
            duration_minutes=(query.end - query.start).total_seconds() / 60,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return SiteAssessment(
        lat=query.lat,
        lon=query.lon,
        start=_utc(query.start),
        end=_utc(query.end),
        step_minutes=query.step_minutes,
        observer_height_m=query.observer_height_m,
        terrain_clearance=TerrainClearanceMetrics(
            sun_visible_p10_deg=sun_clearance.visible_clearance_p10_deg,
            earth_visible_p10_deg=earth_clearance.visible_clearance_p10_deg,
        ),
        solar_continuity=SolarContinuityMetrics(**vars(continuity)),
        sun=_metrics(sun.metrics),
        earth=_metrics(earth.metrics),
        terrain=TerrainMetrics(
            slope_p95_deg=None if region.slope_p95_deg is None else round(region.slope_p95_deg, 3),
            coverage_fraction=round(region.coverage_fraction, 4),
            roughness_p95_m=None
            if region.roughness_p95_m is None
            else round(region.roughness_p95_m, 3),
            dem_pixel_m=float(dem.label.map_scale_m),
        ),
    )
