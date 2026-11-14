"""소프트 선호도: 일조와 지구 가시율을 가중 평균한 순위 점수. 적격 여부와는 별개다."""

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


def score_sites(field: MetricField, weights: Weights) -> RankScores:
    """결측 성분은 0으로 취급하지 않고 빼서 나머지 가중치로 다시 정규화한다."""
    sun, earth = field.sun_fraction, field.earth_fraction
    w_sun = np.where(~np.isnan(sun), weights.sun, 0.0)
    w_earth = np.where(~np.isnan(earth), weights.earth, 0.0)
    total_weight = w_sun + w_earth
    numerator = w_sun * np.nan_to_num(sun) + w_earth * np.nan_to_num(earth)
    with np.errstate(invalid="ignore", divide="ignore"):
        total = np.where(total_weight > 0.0, numerator / total_weight, np.nan)
    used = ((w_sun > 0.0).astype(np.int8)) + ((w_earth > 0.0).astype(np.int8))
    return RankScores(
        total=total, sun_component=sun.copy(), earth_component=earth.copy(), components_used=used
    )
