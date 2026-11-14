"""candidates.json / summary.json의 구조. 출력 스키마이자 읽는 쪽의 타입이다."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SunMetrics(_Model):
    fraction: float | None
    longest_dark_hours: float | None
    windows_per_24h: float | None
    mean_elevation_deg: float | None


class EarthMetrics(_Model):
    fraction: float | None
    longest_blackout_hours: float | None
    windows_per_24h: float | None
    mean_elevation_deg: float | None


class Eligibility(_Model):
    status: Literal["eligible", "excluded", "unevaluated"]
    failed: list[str]  # 위반한 조건
    not_applied: list[str]  # 지표가 결측이라 적용하지 못한 조건


class Score(_Model):
    total: float | None
    sun_component: float | None
    earth_component: float | None
    components_used: int


class DataQuality(_Model):
    horizon_complete: bool  # False면 DEM 밖 지형을 몰라 수평선이 낮게 계산됐을 수 있음
    horizon_max_deg: float | None
    missing_metrics: list[str]
    stage: Literal["fine", "coarse"]


class Selection(_Model):
    picked_as: str  # "region_best" | "fill" | ""
    note: str  # 선정되지 않은 이유 (선정된 점은 "")


class CandidateRecord(_Model):
    id: str
    rank: int
    lat_deg: float
    lon_deg: float
    x_m: float
    y_m: float
    grid_spacing_m: float
    sun: SunMetrics
    earth: EarthMetrics
    eligibility: Eligibility
    score: Score
    region_id: int
    data_quality: DataQuality
    selection: Selection


class DemSource(_Model):
    name: str
    file: str
    sha256: str
    resolution_m: float


class KernelSource(_Model):
    name: str
    sha256: str


class WindowSource(_Model):
    start: str
    end: str
    step_minutes: int


class Source(_Model):
    dem: DemSource
    spice_kernels: list[KernelSource]
    window: WindowSource
    projection: str
    plan_id: str


class Summary(_Model):
    counts: dict[str, int]
    reasons: dict[str, int]  # 탈락·미선정 사유별 점 개수 (한 점이 여러 사유를 가질 수 있다)
    distributions: dict[str, dict[str, float]]
    warnings: list[str]


class RunInfo(_Model):
    generated_at: str
    elapsed_seconds: float
    workers: int
    total_elapsed_seconds: float | None = None
    started_at: str | None = None
    completed_at: str | None = None


class SummaryFile(Summary):
    run: RunInfo


class CandidatesDocument(_Model):
    source: Source
    config: dict[str, object]
    summary: Summary
    candidates: list[CandidateRecord]


class MapMeta(_Model):
    size_px: int
    center_px: int
    pixel_size_m: float
    rho_max_m: float
    layers: list[str]
