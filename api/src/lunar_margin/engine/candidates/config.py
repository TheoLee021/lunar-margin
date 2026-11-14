"""후보지 탐색 설정. ROI, 해상도, 임계값, 가중치, Top-K는 모두 여기서 바꾼다."""

import math
from datetime import UTC, datetime
from typing import Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

# de440s.bsp가 덮는 기간 (약 1849-12-26 ~ 2150-01-22)
EPHEMERIS_START = datetime(1850, 1, 1, tzinfo=UTC)
EPHEMERIS_END = datetime(2150, 1, 1, tzinfo=UTC)


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Roi(_Frozen):
    """남극 위도 띠 [min_lat, max_lat]. 극 쪽이 min, 바깥 경계가 max. 위도는 남쪽이 음수."""

    min_lat_deg: float = Field(default=-90.0, ge=-90.0, le=0.0)
    max_lat_deg: float = Field(default=-85.0, ge=-90.0, le=0.0)

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.min_lat_deg >= self.max_lat_deg:
            raise ValueError("min_lat_deg must be smaller than max_lat_deg")
        if self.max_lat_deg > -60.0:
            raise ValueError("only the south polar region (max_lat_deg <= -60) is supported")
        return self


class Thresholds(_Frozen):
    """필수 적격 조건. None이면 그 조건은 적용하지 않는다. 경계값은 포함(>=, <=)한다."""

    min_sun_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    max_sun_dark_hours: float | None = Field(default=None, ge=0.0)
    min_earth_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    max_earth_blackout_hours: float | None = Field(default=None, ge=0.0)


class Weights(_Frozen):
    """소프트 선호도 (순위 점수). 합이 1일 필요는 없고 비율만 쓴다."""

    sun: float = Field(default=0.5, ge=0.0)
    earth: float = Field(default=0.5, ge=0.0)

    @model_validator(mode="after")
    def _not_all_zero(self) -> Self:
        if self.sun + self.earth <= 0.0:
            raise ValueError("at least one weight must be positive")
        return self


class AnalysisWindow(_Frozen):
    """분석 기간. 기본은 19년(월 궤도 승교점 주기 약 18.6년의 1주기)이다.

    기간이 길수록 평균 지표는 장기 평균에 가까워지고, 최장 암흑·두절 시간은 그 기간 중
    최악값이 된다. 천체력(DE440s)이 허용하는 1850~2150년 안에서 100년 창도 쓸 수 있다.
    """

    start: AwareDatetime = datetime(2027, 1, 1, tzinfo=UTC)
    end: AwareDatetime = datetime(2046, 1, 1, tzinfo=UTC)
    step_minutes: int = Field(default=60, ge=5, le=720)

    @model_validator(mode="after")
    def _valid(self) -> Self:
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if self.start < EPHEMERIS_START or self.end > EPHEMERIS_END:
            raise ValueError("the window must stay inside the ephemeris coverage (1850-2150)")
        return self

    def sample_count(self) -> int:
        return math.ceil((self.end - self.start).total_seconds() / (self.step_minutes * 60))


class SearchConfig(_Frozen):
    roi: Roi = Roi()
    grid_spacing_m: float = Field(default=500.0, gt=0.0)
    # 거친 단계 간격. None이면 한 단계로 전부 계산한다. grid_spacing_m의 정수배여야 한다
    coarse_spacing_m: float | None = Field(default=2000.0, gt=0.0)
    # 거친 단계에서 적격한 점 중 점수 상위 이 비율의 주변만 세밀하게 다시 계산 (1.0이면 전부)
    refine_fraction: float = Field(default=0.25, gt=0.0, le=1.0)
    min_separation_m: float = Field(default=2000.0, ge=0.0)
    top_k: int = Field(default=100, ge=1)
    thresholds: Thresholds = Thresholds()
    weights: Weights = Weights()
    window: AnalysisWindow = AnalysisWindow()
    dem: str = "80s_80m"
    observer_height_m: float = Field(default=0.0, ge=0.0, le=100.0)
    max_range_m: float = Field(default=200_000.0, gt=0.0)
    coarse_azimuth_step_deg: float = Field(default=2.0, gt=0.0, le=10.0)
    fine_azimuth_step_deg: float = Field(default=1.0, gt=0.0, le=10.0)
    # 수평선이 불완전(DEM 밖으로 나감)한 점을 적격에서 제외할지. 기본은 표시만 한다
    exclude_incomplete_horizon: bool = False
    workers: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _spacings(self) -> Self:
        if self.coarse_spacing_m is None:
            return self
        if self.coarse_spacing_m < self.grid_spacing_m:
            raise ValueError("the coarse spacing must not be finer than the grid spacing")
        ratio = self.coarse_spacing_m / self.grid_spacing_m
        if abs(ratio - round(ratio)) > 1e-9:
            raise ValueError("coarse_spacing_m must be a whole multiple of grid_spacing_m")
        return self
