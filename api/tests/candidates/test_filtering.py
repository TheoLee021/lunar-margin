import numpy as np
from candidate_helpers import make_field

from lunar_margin.engine.candidates.config import Thresholds
from lunar_margin.engine.candidates.filtering import (
    EARTH_BLACKOUT_HIGH,
    EARTH_FRACTION_LOW,
    HORIZON_INCOMPLETE,
    SUN_DARK_HIGH,
    SUN_FRACTION_LOW,
    Status,
    evaluate,
    reason_names,
)

NAN = float("nan")


def test_no_thresholds_means_every_computed_site_is_eligible() -> None:
    field = make_field(sun=[0.0, 0.5], earth=[0.0, 0.5])

    result = evaluate(field, Thresholds())

    assert result.status.tolist() == [Status.ELIGIBLE, Status.ELIGIBLE]
    assert result.failed.tolist() == [0, 0]


def test_min_threshold_boundary_is_inclusive() -> None:
    field = make_field(sun=[0.299999, 0.3, 0.300001])

    result = evaluate(field, Thresholds(min_sun_fraction=0.3))

    assert result.status.tolist() == [Status.EXCLUDED, Status.ELIGIBLE, Status.ELIGIBLE]
    assert result.failed[0] == SUN_FRACTION_LOW


def test_max_threshold_boundary_is_inclusive() -> None:
    field = make_field(dark=[99.9, 100.0, 100.1], sun=[0.5, 0.5, 0.5])

    result = evaluate(field, Thresholds(max_sun_dark_hours=100.0))

    assert result.status.tolist() == [Status.ELIGIBLE, Status.ELIGIBLE, Status.EXCLUDED]
    assert result.failed[2] == SUN_DARK_HIGH


def test_all_four_thresholds_report_every_failed_reason() -> None:
    field = make_field(sun=[0.1], dark=[500.0], earth=[0.1], blackout=[500.0])
    thresholds = Thresholds(
        min_sun_fraction=0.3,
        max_sun_dark_hours=100.0,
        min_earth_fraction=0.3,
        max_earth_blackout_hours=100.0,
    )

    result = evaluate(field, thresholds)

    assert result.status[0] == Status.EXCLUDED
    assert result.failed[0] == (
        SUN_FRACTION_LOW | SUN_DARK_HIGH | EARTH_FRACTION_LOW | EARTH_BLACKOUT_HIGH
    )
    assert reason_names(int(result.failed[0])) == [
        "sun_fraction_below_min",
        "sun_dark_hours_above_max",
        "earth_fraction_below_min",
        "earth_blackout_hours_above_max",
    ]


def test_missing_metric_is_not_filtered_and_never_treated_as_zero() -> None:
    # 지구 지표가 결측: min_earth_fraction=0.9가 있어도 이 지점을 탈락시키지 않는다
    field = make_field(sun=[0.5], earth=[NAN])

    result = evaluate(field, Thresholds(min_sun_fraction=0.3, min_earth_fraction=0.9))

    assert result.status[0] == Status.ELIGIBLE
    assert result.failed[0] == 0
    assert result.skipped[0] == EARTH_FRACTION_LOW  # 적용하지 못한 조건으로 기록


def test_site_is_unevaluated_when_nothing_could_be_checked() -> None:
    field = make_field(sun=[NAN, 0.5], earth=[NAN, 0.5])

    # 첫 지점: 아무 지표도 없음 / 임계값이 있어도 판정할 근거가 없다
    result = evaluate(field, Thresholds(min_sun_fraction=0.3))

    assert result.status.tolist() == [Status.UNEVALUATED, Status.ELIGIBLE]
    assert result.skipped[0] == SUN_FRACTION_LOW


def test_uncomputed_site_is_unevaluated_even_without_thresholds() -> None:
    field = make_field(sun=[NAN], earth=[NAN])

    assert evaluate(field, Thresholds()).status[0] == Status.UNEVALUATED


def test_incomplete_horizon_is_only_flagged_unless_requested() -> None:
    field = make_field(sun=[0.5, 0.5], complete=[True, False])

    flagged = evaluate(field, Thresholds())
    strict = evaluate(field, Thresholds(), exclude_incomplete_horizon=True)

    assert flagged.status.tolist() == [Status.ELIGIBLE, Status.ELIGIBLE]
    assert strict.status.tolist() == [Status.ELIGIBLE, Status.EXCLUDED]
    assert strict.failed[1] == HORIZON_INCOMPLETE


def test_results_have_one_entry_per_site() -> None:
    field = make_field(sun=[0.5] * 5)

    result = evaluate(field, Thresholds(min_sun_fraction=0.4))

    assert result.status.shape == result.failed.shape == result.skipped.shape == (5,)
    assert result.status.dtype == np.int8


def test_concat_keeps_order_and_every_column() -> None:
    from lunar_margin.engine.candidates.field import MetricField

    a = make_field(sun=[0.1, 0.2], complete=[True, False])
    b = make_field(sun=[0.3], complete=[True])

    joined = MetricField.concat([a, b])

    assert joined.sun_fraction.tolist() == [0.1, 0.2, 0.3]
    assert joined.horizon_complete.tolist() == [True, False, True]
    assert len(joined) == 3


# --- 제약에 얼마나 가까운가 (세밀화 대상을 고를 때 쓴다) -----------------------------------


def test_constraint_ratio_is_the_worst_value_to_limit_ratio() -> None:
    from lunar_margin.engine.candidates.filtering import constraint_ratio

    field = make_field(dark=[12.0, 48.0, 24.0], blackout=[3.0, 6.0, 12.0], sun=[0.5] * 3)
    thresholds = Thresholds(max_sun_dark_hours=24.0, max_earth_blackout_hours=6.0)

    ratio = constraint_ratio(field, thresholds)

    assert ratio.tolist() == [0.5, 2.0, 2.0]  # 1.0 이하면 조건을 만족


def test_constraint_ratio_for_minimum_thresholds_is_limit_over_value() -> None:
    from lunar_margin.engine.candidates.filtering import constraint_ratio

    field = make_field(sun=[0.5, 0.25, 0.0])

    ratio = constraint_ratio(field, Thresholds(min_sun_fraction=0.5))

    assert ratio[0] == 1.0 and ratio[1] == 2.0 and np.isinf(ratio[2])


def test_constraint_ratio_with_a_zero_limit_is_zero_or_infinite() -> None:
    from lunar_margin.engine.candidates.filtering import constraint_ratio

    field = make_field(dark=[0.0, 5.0], sun=[0.5, 0.5])

    ratio = constraint_ratio(field, Thresholds(max_sun_dark_hours=0.0))

    assert ratio[0] == 0.0 and np.isinf(ratio[1])


def test_constraint_ratio_ignores_missing_metrics_and_is_nan_when_nothing_applies() -> None:
    from lunar_margin.engine.candidates.filtering import constraint_ratio

    field = make_field(dark=[48.0, NAN], blackout=[NAN, NAN], sun=[0.5, NAN])

    ratio = constraint_ratio(
        field, Thresholds(max_sun_dark_hours=24.0, max_earth_blackout_hours=6.0)
    )

    assert ratio[0] == 2.0  # 결측인 두절 시간은 계산에서 빠진다
    assert np.isnan(ratio[1])  # 적용할 수 있는 조건이 하나도 없다


def test_constraint_ratio_is_nan_everywhere_without_thresholds() -> None:
    from lunar_margin.engine.candidates.filtering import constraint_ratio

    assert np.all(np.isnan(constraint_ratio(make_field(sun=[0.5, 0.1]), Thresholds())))
