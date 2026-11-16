from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.engine.candidates.mission import MissionRequest, plan_search

# 사용자가 제시한 입력 예시 그대로
EXAMPLE = {
    "landing_date": "2027-01-01",
    "mission_duration_days": 14,
    "max_continuous_darkness_hours": 24,
    "max_communication_blackout_hours": 6,
    "max_terrain_slope_degrees": 10,
    "search_region": "south",
    "optimization_priority": "balanced",
    "observer_height_m": None,
}


def test_the_example_input_parses_exactly_as_given() -> None:
    mission = MissionRequest.model_validate(EXAMPLE)

    assert mission.landing_date == date(2027, 1, 1)
    assert mission.mission_duration_days == 14
    assert mission.max_continuous_darkness_hours == 24
    assert mission.max_communication_blackout_hours == 6
    assert mission.max_terrain_slope_degrees == 10
    assert mission.search_region == "south" and mission.optimization_priority == "balanced"
    assert mission.observer_height_m is None


def test_landing_date_and_duration_become_the_analysis_window() -> None:
    plan = plan_search(MissionRequest.model_validate(EXAMPLE))

    window = plan.config.window
    assert window.start == datetime(2027, 1, 1, tzinfo=UTC)
    assert window.end == datetime(2027, 1, 15, tzinfo=UTC)  # 14일 뒤 (끝 미포함)
    assert window.step_minutes == 30


def test_constraints_become_hard_thresholds_and_nothing_else_is_filtered() -> None:
    thresholds = plan_search(MissionRequest.model_validate(EXAMPLE)).config.thresholds

    assert thresholds.max_sun_dark_hours == 24
    assert thresholds.max_earth_blackout_hours == 6
    assert thresholds.min_sun_fraction is None and thresholds.min_earth_fraction is None


def test_missing_constraints_mean_no_filter_not_zero() -> None:
    mission = MissionRequest.model_validate(
        {**EXAMPLE, "max_continuous_darkness_hours": None, "max_communication_blackout_hours": None}
    )

    thresholds = plan_search(mission).config.thresholds

    assert thresholds.max_sun_dark_hours is None and thresholds.max_earth_blackout_hours is None


@pytest.mark.parametrize(
    ("priority", "sun", "earth", "visibility"),
    [
        ("balanced", 0.4, 0.4, 0.2),
        ("solar", 0.6, 0.2, 0.2),
        ("earth", 0.2, 0.6, 0.2),
        ("visibility", 0.25, 0.25, 0.5),
    ],
)
def test_priority_sets_the_score_weights(
    priority: str, sun: float, earth: float, visibility: float
) -> None:
    mission = MissionRequest.model_validate({**EXAMPLE, "optimization_priority": priority})

    weights = plan_search(mission).config.weights

    assert (weights.sun, weights.earth, weights.visibility) == (sun, earth, visibility)


def test_null_observer_height_means_ground_level() -> None:
    assert plan_search(MissionRequest.model_validate(EXAMPLE)).config.observer_height_m == 0.0
    tall = MissionRequest.model_validate({**EXAMPLE, "observer_height_m": 2.5})
    assert plan_search(tall).config.observer_height_m == 2.5


def test_slope_is_enforced_and_unset_slope_disables_the_filter() -> None:
    plan = plan_search(MissionRequest.model_validate(EXAMPLE))

    assert plan.config.thresholds.max_terrain_slope_degrees == 10
    no_slope = plan_search(
        MissionRequest.model_validate({**EXAMPLE, "max_terrain_slope_degrees": None})
    )
    assert no_slope.config.thresholds.max_terrain_slope_degrees is None


def test_other_search_settings_keep_their_defaults() -> None:
    config = plan_search(MissionRequest.model_validate(EXAMPLE)).config
    base = SearchConfig()

    assert config.roi == base.roi and config.grid_spacing_m == base.grid_spacing_m
    assert config.coarse_spacing_m == base.coarse_spacing_m and config.top_k == base.top_k


@pytest.mark.parametrize(
    "bad",
    [
        {"mission_duration_days": 0},
        {"mission_duration_days": 366},
        {"max_continuous_darkness_hours": -1},
        {"max_communication_blackout_hours": -0.5},
        {"max_terrain_slope_degrees": 0},
        {"max_terrain_slope_degrees": 91},
        {"observer_height_m": -1},
        {"observer_height_m": 101},
        {"optimization_priority": "fast"},
        {"landing_date": "not-a-date"},
        {"landing_date": "1800-01-01"},
        {"landing_date": "2150-12-31"},  # 천체력 범위를 넘어 임무 기간이 끝난다
        {"unknown_field": 1},
    ],
)
def test_invalid_input_is_rejected(bad: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        plan_search(MissionRequest.model_validate({**EXAMPLE, **bad}))


def test_global_search_is_clearly_not_available_yet() -> None:
    with pytest.raises(ValidationError, match="planned"):
        MissionRequest.model_validate({**EXAMPLE, "search_region": "global"})


def test_same_request_has_the_same_stable_run_id_and_different_ones_differ() -> None:
    a = MissionRequest.model_validate(EXAMPLE)
    b = MissionRequest.model_validate(EXAMPLE)
    c = MissionRequest.model_validate({**EXAMPLE, "mission_duration_days": 7})

    assert a.run_id() == b.run_id() != c.run_id()
    assert a.run_id().startswith("m-") and len(a.run_id()) <= 64
