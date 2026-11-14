"""가시성 시계열과 요약 지표 (일조 / 지구 직접 통신)."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.ephemeris import body_azel, utc_range
from lunar_margin.engine.horizon import HorizonProfile, horizon_profile


@dataclass(frozen=True)
class VisibilityMetrics:
    visible_fraction: float  # 평균 일조율 / 평균 지구 가시율
    longest_dark_hours: float  # 최장 연속 암흑 / 최장 통신 두절
    windows_per_24h: float  # 24시간당 가시 구간(일조 창) 횟수
    mean_elevation_deg: float | None  # 가시 구간 평균 고도각 (가시 구간이 없으면 None)


@dataclass(frozen=True)
class SiteAnalysis:
    metrics: VisibilityMetrics
    horizon: HorizonProfile
    times: list[datetime]
    body_azimuth_deg: NDArray[np.float64]
    body_elevation_deg: NDArray[np.float64]
    visible: NDArray[np.bool_]
    step_minutes: int


def find_runs(mask: NDArray[np.bool_], value: bool) -> list[tuple[int, int]]:
    """mask가 value인 연속 구간의 [시작, 끝) 인덱스 목록."""
    if mask.size == 0:
        return []
    padded = np.concatenate(([False], mask == value, [False])).astype(np.int8)
    edges = np.flatnonzero(np.diff(padded))
    return [(int(a), int(b)) for a, b in zip(edges[::2], edges[1::2], strict=True)]


def visibility_series(
    horizon: HorizonProfile,
    azimuth_deg: NDArray[np.float64],
    elevation_deg: NDArray[np.float64],
) -> NDArray[np.bool_]:
    """천체 중심 고도가 그 방위각의 지형 수평선보다 높으면 True."""
    return elevation_deg > horizon.at(azimuth_deg)


def summarize(
    visible: NDArray[np.bool_], step_minutes: int, elevation_deg: NDArray[np.float64]
) -> VisibilityMetrics:
    if visible.size == 0:
        raise ValueError("empty series")
    if visible.shape != elevation_deg.shape:
        raise ValueError("visible and elevation_deg must have the same length")
    step_hours = step_minutes / 60.0
    duration_days = visible.size * step_hours / 24.0
    dark = find_runs(visible, False)
    longest_dark = max((b - a for a, b in dark), default=0) * step_hours
    windows = len(find_runs(visible, True))
    return VisibilityMetrics(
        visible_fraction=float(visible.mean()),
        longest_dark_hours=float(longest_dark),
        windows_per_24h=windows / duration_days,
        mean_elevation_deg=float(elevation_deg[visible].mean()) if visible.any() else None,
    )


def analyze_site(
    dem: PolarDem,
    lat_deg: float,
    lon_deg: float,
    body: Literal["SUN", "EARTH"],
    start: datetime,
    end: datetime,
    step_minutes: int = 30,
    observer_height_m: float = 0.0,
) -> SiteAnalysis:
    horizon = horizon_profile(dem, lat_deg, lon_deg, observer_height_m=observer_height_m)
    et = utc_range(start, end, step_minutes)
    azimuth, elevation = body_azel(body, lat_deg, lon_deg, et, observer_height_m)
    visible = visibility_series(horizon, azimuth, elevation)
    step = timedelta(minutes=step_minutes)
    return SiteAnalysis(
        metrics=summarize(visible, step_minutes, elevation),
        horizon=horizon,
        times=[start + step * i for i in range(len(et))],
        body_azimuth_deg=azimuth,
        body_elevation_deg=elevation,
        visible=visible,
        step_minutes=step_minutes,
    )
