"""Original-baseline continuous-sunlight metrics, kept separate from DTE."""

import numpy as np
import pytest

from lunar_margin.engine.solar_continuity import summarize_solar_continuity


@pytest.mark.parametrize(
    ("pattern", "longest_h", "transitions"),
    [
        ("VVVDDVVVVD", 2.0, 3),
        ("DDDDD", 0.0, 0),
        ("VVVV", 2.0, 0),
        ("DVDVD", 0.5, 4),
        ("V", 0.5, 0),
        ("D", 0.0, 0),
    ],
)
def test_longest_continuous_sun_visibility(
    pattern: str, longest_h: float, transitions: int
) -> None:
    mask = np.array([v == "V" for v in pattern], dtype=np.bool_)
    result = summarize_solar_continuity(mask, 30)
    assert result.longest_sun_visible_hours == pytest.approx(longest_h)
    assert result.visibility_transitions == transitions


def test_step_size_changes_duration_not_transition_count() -> None:
    mask = np.array([True, True, False, False, True], dtype=np.bool_)
    hourly = summarize_solar_continuity(mask, 60)
    halfhour = summarize_solar_continuity(mask, 30)
    assert hourly.longest_sun_visible_hours == 2.0
    assert halfhour.longest_sun_visible_hours == 1.0
    assert hourly.visibility_transitions == halfhour.visibility_transitions == 2


@pytest.mark.parametrize(
    ("data", "step"),
    [
        (np.array([], dtype=np.bool_), 30),
        (np.array([[True, False]], dtype=np.bool_), 30),
        (np.array([1, 0], dtype=np.int64), 30),
        (np.array([True], dtype=np.bool_), 0),
    ],
)
def test_invalid_visibility_inputs_rejected(data: np.ndarray, step: int) -> None:
    with pytest.raises(ValueError):
        summarize_solar_continuity(data, step)
