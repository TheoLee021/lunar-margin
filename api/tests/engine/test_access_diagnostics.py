"""Independent synthetic checks for baseline access and opt-in RF diagnostics."""

import numpy as np
import pytest

from lunar_margin.engine.access_diagnostics import (
    RFConfig,
    access_diagnostics,
    nominal_rf_diagnostics,
    target_range_km,
)
from lunar_margin.engine.horizon import HorizonProfile


def test_access_window_transitions_and_clearance() -> None:
    horizon = HorizonProfile(
        azimuth_deg=np.array([0.0, 180.0]), elevation_deg=np.array([0.0, 0.0])
    )
    azimuth = np.zeros(6)
    elevation = np.array([-1.0, 0.2, 1.0, -2.0, 0.3, 0.4])
    visible = elevation > 0.0
    result = access_diagnostics(horizon, azimuth, elevation, visible, 30)
    assert result.longest_visible_hours == pytest.approx(1.0)
    assert result.transitions == 3
    assert result.clearance_p10_deg == pytest.approx(0.23)


def test_no_visible_access_keeps_clearance_unknown() -> None:
    horizon = HorizonProfile(
        azimuth_deg=np.array([0.0, 180.0]), elevation_deg=np.array([0.0, 0.0])
    )
    result = access_diagnostics(horizon, np.zeros(3), -np.ones(3), np.zeros(3, dtype=bool), 30)
    assert result.longest_visible_hours == 0.0
    assert result.clearance_p10_deg is None
    assert result.transitions == 0


def test_earth_range_accounts_for_site_offset() -> None:
    vectors = np.array([[384_400.0, 0.0, 0.0]])
    ranges = target_range_km(vectors, 0.0, 0.0)
    assert ranges[0] == pytest.approx(384_400.0 - 1_737.4)


def config() -> RFConfig:
    return RFConfig(
        frequency_hz=2.2e9,
        tx_power_w=10.0,
        tx_gain_dbi=20.0,
        rx_gain_dbi=65.0,
        misc_loss_db=3.0,
        rx_required_dbm=-105.0,
        target_margin_db=3.0,
    )


def test_rf_results_are_los_gated_and_threshold_based() -> None:
    distances = np.full(4, 384_400.0)
    geometric_visible = np.array([True, False, True, True])
    result = nominal_rf_diagnostics(distances, geometric_visible, 30, config())
    assert result.available_fraction == pytest.approx(0.75)
    assert result.longest_unavailable_hours == pytest.approx(0.5)
    assert result.min_visible_margin_db == pytest.approx(16.008, abs=0.02)


def test_rf_can_reject_visible_geometry() -> None:
    low_gain = RFConfig(
        frequency_hz=2.2e9,
        tx_power_w=10.0,
        tx_gain_dbi=0.0,
        rx_gain_dbi=0.0,
        misc_loss_db=3.0,
        rx_required_dbm=-105.0,
        target_margin_db=3.0,
    )
    result = nominal_rf_diagnostics(
        np.array([384_400.0, 384_400.0]),
        np.array([True, True]),
        60,
        low_gain,
    )
    assert result.available_fraction == 0.0
    assert result.longest_unavailable_hours == 2.0
    assert result.min_visible_margin_db is not None
    assert result.min_visible_margin_db < 3.0


def test_invalid_rf_inputs_are_rejected() -> None:
    with pytest.raises(ValueError, match="positive"):
        nominal_rf_diagnostics(np.array([-1.0]), np.array([True]), 30, config())
