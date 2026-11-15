"""Synthetic geometry checks for terrain clearance (no RF assumptions)."""

import numpy as np
import pytest

from lunar_margin.engine.clearance import terrain_clearance_diagnostics
from lunar_margin.engine.horizon import HorizonProfile


def test_clearance_wrap_and_positive_percentile() -> None:
    horizon = HorizonProfile(
        azimuth_deg=np.array([0.0, 90.0, 180.0, 270.0]),
        elevation_deg=np.array([0.0, 2.0, 4.0, 2.0]),
    )
    result = terrain_clearance_diagnostics(
        horizon,
        np.array([0.0, 90.0, 180.0, 315.0, -45.0]),
        np.array([-1.0, 4.0, 4.0, 2.0, 0.0]),
    )
    assert result.clearance_deg == pytest.approx([-1.0, 2.0, 0.0, 1.0, -1.0])
    assert result.visible_clearance_p10_deg == pytest.approx(1.1)


def test_no_geometric_access_returns_null_percentile() -> None:
    h = HorizonProfile(np.array([0.0, 180.0]), np.array([0.0, 0.0]))
    result = terrain_clearance_diagnostics(
        h, np.zeros(3), np.array([-2.0, -1.0, 0.0])
    )
    assert result.visible_clearance_p10_deg is None


@pytest.mark.parametrize(
    "azimuth,elevation",
    [
        (np.zeros(0), np.zeros(0)),
        (np.zeros(2), np.zeros(3)),
        (np.array([np.nan]), np.zeros(1)),
        (np.zeros(1), np.array([np.inf])),
    ],
)
def test_invalid_angles_fail_closed(azimuth: np.ndarray, elevation: np.ndarray) -> None:
    h = HorizonProfile(np.array([0.0, 180.0]), np.array([0.0, 0.0]))
    with pytest.raises(ValueError):
        terrain_clearance_diagnostics(h, azimuth, elevation)
