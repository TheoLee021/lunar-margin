"""Rank sunlight and communication preferences separately from hard eligibility."""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.candidates.config import Weights
from lunar_margin.engine.candidates.field import MetricField


@dataclass(frozen=True)
class RankScores:
    total: NDArray[np.float64]  # 사용 가능한 성분만으로 가중치를 다시 정규화한 점수. 없으면 NaN
    sun_component: NDArray[np.float64]  # 일조율 (결측이면 NaN)
    earth_component: NDArray[np.float64]  # 지구 가시율 (결측이면 NaN)
    components_used: NDArray[np.int8]  # 점수 계산에 실제로 쓰인 성분 수 (0~2)


def communication_component(
    field: MetricField, *, rf: bool, duration_hours: float
) -> NDArray[np.float64]:
    """Equal preference for availability and continuity, normalized to [0, 1]."""
    if not rf:
        return field.earth_fraction
    if duration_hours <= 0:
        raise ValueError("ranking duration must be positive")
    return (field.rf_fraction + 1 - field.rf_longest_blackout_h / duration_hours) / 2


def score_sites(
    field: MetricField, weights: Weights, *, rf: bool = False, duration_hours: float = 1.0
) -> RankScores:
    """결측 성분은 0으로 취급하지 않고 빼서 나머지 가중치로 다시 정규화한다."""
    sun, earth = field.sun_fraction, field.earth_fraction
    communication = communication_component(field, rf=rf, duration_hours=duration_hours)
    w_sun = np.where(~np.isnan(sun), weights.sun, 0.0)
    w_earth = np.where(~np.isnan(communication), weights.earth, 0.0)
    total_weight = w_sun + w_earth
    numerator = w_sun * np.nan_to_num(sun) + w_earth * np.nan_to_num(communication)
    with np.errstate(invalid="ignore", divide="ignore"):
        total = np.where(total_weight > 0.0, numerator / total_weight, np.nan)
    used = ((w_sun > 0.0).astype(np.int8)) + ((w_earth > 0.0).astype(np.int8))
    return RankScores(
        total=total, sun_component=sun.copy(), earth_component=earth.copy(), components_used=used
    )
