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


class RFMetrics(_Model):
    """Duration-weighted nominal DTE communication results."""

    fraction: float | None
    longest_blackout_hours: float | None
    min_link_margin_db: float | None
    required_ebn0_db: float
    rx_required_dbw: float
    evaluation_hours: float
    available_hours: float | None


class Eligibility(_Model):
    status: Literal["eligible", "excluded", "unevaluated"]
    failed: list[str]  # 위반한 조건
    not_applied: list[str]  # 지표가 결측이라 적용하지 못한 조건


class Score(_Model):
    communication_component: float | None = None
    communication_basis: Literal["earth_los", "nominal_rf"] = "earth_los"
    total: float | None
    sun_component: float | None
    earth_component: float | None
    visible_grid_points: int | None = None
    components_used: int


class DataQuality(_Model):
    horizon_complete: bool  # False면 DEM 밖 지형을 몰라 수평선이 낮게 계산됐을 수 있음
    horizon_max_deg: float | None
    missing_metrics: list[str]
    stage: Literal["fine", "coarse"]


class Selection(_Model):
    picked_as: str  # "region_best" | "fill" | ""
    note: str  # 선정되지 않은 이유 (선정된 점은 "")


class TerrainMetrics(_Model):
    roughness_p95_m: float | None = None
    slope_p95_deg: float | None
    coverage_fraction: float | None
    assessment_radius_m: float = 250.0
    slope_baseline_m: float = 160.0
    roughness_window_m: float = 400.0
    dem_pixel_m: float
    landing_safety_status: Literal["UNVERIFIED"] = "UNVERIFIED"


class CandidateRecord(_Model):
    id: str
    rank: int
    lat_deg: float
    lon_deg: float
    x_m: float
    y_m: float
    grid_spacing_m: float
    terrain: TerrainMetrics | None = None  # Absent on historical runs or when not requested.
    rf: RFMetrics | None = None
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
    dem_fallback: DemSource | None = None  # 주 DEM 밖을 메운 보충 DEM (쓰지 않았으면 null)
    spice_kernels: list[KernelSource]
    window: WindowSource
    projection: str
    plan_id: str
    horizon_table: str | None = None  # 사전 계산한 수평선 테이블 id (직접 계산했으면 null)


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
