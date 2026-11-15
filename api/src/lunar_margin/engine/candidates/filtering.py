"""필수 적격 조건(hard constraint). 결측 지표로는 판정하지 않고, 적용하지 못한 조건을 기록한다."""

from dataclasses import dataclass
from enum import IntEnum

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.candidates.config import Thresholds
from lunar_margin.engine.candidates.field import MetricField

SUN_FRACTION_LOW = 1 << 0
SUN_DARK_HIGH = 1 << 1
EARTH_FRACTION_LOW = 1 << 2
EARTH_BLACKOUT_HIGH = 1 << 3
HORIZON_INCOMPLETE = 1 << 4
TERRAIN_SLOPE_HIGH = 1 << 5
TERRAIN_INCOMPLETE = 1 << 6
TERRAIN_ROUGHNESS_HIGH = 1 << 7

RF_FRACTION_LOW = 1 << 8
RF_BLACKOUT_HIGH = 1 << 9
RF_INCOMPLETE = 1 << 10

_REASONS: tuple[tuple[int, str], ...] = (
    (RF_INCOMPLETE, "rf_incomplete"),
    (RF_FRACTION_LOW, "rf_fraction_below_min"),
    (RF_BLACKOUT_HIGH, "rf_blackout_hours_above_max"),
    (SUN_FRACTION_LOW, "sun_fraction_below_min"),
    (SUN_DARK_HIGH, "sun_dark_hours_above_max"),
    (EARTH_FRACTION_LOW, "earth_fraction_below_min"),
    (EARTH_BLACKOUT_HIGH, "earth_blackout_hours_above_max"),
    (HORIZON_INCOMPLETE, "horizon_incomplete"),
    (TERRAIN_SLOPE_HIGH, "terrain_slope_above_max"),
    (TERRAIN_INCOMPLETE, "terrain_incomplete"),
    (TERRAIN_ROUGHNESS_HIGH, "terrain_roughness_above_max"),
)


class Status(IntEnum):
    ELIGIBLE = 0
    EXCLUDED = 1
    UNEVALUATED = 2  # 판정할 근거 지표가 하나도 없음


@dataclass(frozen=True)
class FilterResult:
    status: NDArray[np.int8]
    failed: NDArray[np.uint16]  # 위반한 조건의 비트 마스크
    skipped: NDArray[np.uint16]  # 임계값은 있지만 지표가 결측이라 적용하지 못한 조건


def reason_names(mask: int) -> list[str]:
    return [name for bit, name in _REASONS if mask & bit]


def evaluate(
    field: MetricField,
    thresholds: Thresholds,
    *,
    exclude_incomplete_horizon: bool = False,
) -> FilterResult:
    """min 임계값은 `>=`, max 임계값은 `<=`를 통과한다 (경계값 포함)."""
    n = len(field)
    failed = np.zeros(n, dtype=np.uint16)
    skipped = np.zeros(n, dtype=np.uint16)
    applied_any = np.zeros(n, dtype=np.bool_)

    criteria: tuple[tuple[float | None, NDArray[np.float64], int, bool], ...] = (
        (thresholds.min_rf_fraction, field.rf_fraction, RF_FRACTION_LOW, True),
        (thresholds.max_rf_blackout_hours, field.rf_longest_blackout_h, RF_BLACKOUT_HIGH, False),
        (thresholds.min_sun_fraction, field.sun_fraction, SUN_FRACTION_LOW, True),
        (thresholds.max_sun_dark_hours, field.sun_longest_dark_h, SUN_DARK_HIGH, False),
        (thresholds.min_earth_fraction, field.earth_fraction, EARTH_FRACTION_LOW, True),
        (
            thresholds.max_earth_blackout_hours,
            field.earth_longest_blackout_h,
            EARTH_BLACKOUT_HIGH,
            False,
        ),
    )
    any_threshold = False
    for limit, values, bit, is_minimum in criteria:
        if limit is None:
            continue
        any_threshold = True
        available = ~np.isnan(values)
        skipped[~available] |= bit
        if bit in (RF_FRACTION_LOW, RF_BLACKOUT_HIGH):
            failed[~available] |= RF_INCOMPLETE
            applied_any |= field.computed
        applied_any |= available
        with np.errstate(invalid="ignore"):
            violated = (values < limit) if is_minimum else (values > limit)
        failed[available & violated] |= bit

    for limit, values, bit in (
        (thresholds.max_terrain_slope_degrees, field.terrain_slope_p95_deg, TERRAIN_SLOPE_HIGH),
        (thresholds.max_terrain_roughness_m, field.terrain_roughness_p95_m, TERRAIN_ROUGHNESS_HIGH),
    ):
        if limit is None:
            continue
        any_threshold = True
        available = np.isfinite(values)
        complete = field.terrain_coverage_fraction >= 0.9999
        failed[~available | ~complete] |= TERRAIN_INCOMPLETE
        failed[available & (values > limit)] |= bit
        applied_any |= field.computed

    if exclude_incomplete_horizon:
        failed[field.computed & ~field.horizon_complete] |= HORIZON_INCOMPLETE

    unevaluated = ~field.computed | (any_threshold & ~applied_any)
    status = np.where(
        unevaluated, Status.UNEVALUATED, np.where(failed != 0, Status.EXCLUDED, Status.ELIGIBLE)
    ).astype(np.int8)
    return FilterResult(status=status, failed=failed, skipped=skipped)


def constraint_ratio(field: MetricField, thresholds: Thresholds) -> NDArray[np.float64]:
    """제약에 얼마나 가까운가: 지점별 (값 / 한도)의 최댓값. 1.0 이하면 모든 조건을 만족한다.

    max 한도는 값/한도, min 한도는 한도/값이다. 한도가 0이면 값이 0일 때만 0, 아니면 무한대다.
    결측 지표는 계산에서 빠지고, 적용할 수 있는 조건이 하나도 없으면 NaN이다.
    거친 격자에서 아직 한도를 못 지키지만 가까운 점을 골라 세밀하게 다시 볼 때 쓴다.
    """
    n = len(field)
    worst = np.full(n, -np.inf)
    criteria: tuple[tuple[float | None, NDArray[np.float64], bool], ...] = (
        (thresholds.min_rf_fraction, field.rf_fraction, True),
        (thresholds.max_rf_blackout_hours, field.rf_longest_blackout_h, False),
        (thresholds.min_sun_fraction, field.sun_fraction, True),
        (thresholds.max_sun_dark_hours, field.sun_longest_dark_h, False),
        (thresholds.min_earth_fraction, field.earth_fraction, True),
        (thresholds.max_earth_blackout_hours, field.earth_longest_blackout_h, False),
        (thresholds.max_terrain_slope_degrees, field.terrain_slope_p95_deg, False),
        (thresholds.max_terrain_roughness_m, field.terrain_roughness_p95_m, False),
    )
    for limit, values, is_minimum in criteria:
        if limit is None:
            continue
        with np.errstate(divide="ignore", invalid="ignore"):
            if is_minimum:
                ratio = np.where(values > 0.0, limit / values, np.inf)
                ratio = np.where((values == 0.0) & (limit == 0.0), 0.0, ratio)
            elif limit > 0.0:
                ratio = values / limit
            else:
                ratio = np.where(values <= 0.0, 0.0, np.inf)
        usable = ~np.isnan(values)
        worst = np.where(usable, np.maximum(worst, ratio), worst)
    return np.where(np.isneginf(worst), np.nan, worst)
