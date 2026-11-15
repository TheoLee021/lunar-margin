"""Synthetic DEM regression checks for coarse local landing-target screening."""

import math

import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.landing_grid import evaluate_landing_grid
from lunar_margin.pipeline.pds_label import PolarGridLabel


def dem_with(heights_m: NDArray[np.float32], step_m: float = 80.0) -> PolarDem:
    n = int(heights_m.shape[0])
    assert heights_m.shape == (n, n)
    label = PolarGridLabel(n, n, step_m, (n - 1) / 2, (n - 1) / 2, 1737.4, 1737.4, -90.0)
    return PolarDem((heights_m / 1000.0).astype(np.float32), label)


def test_flat_grid_has_screened_target_but_never_claims_safety() -> None:
    dem = dem_with(np.zeros((101, 101), dtype=np.float32))
    result = evaluate_landing_grid(dem, -90.0, 0.0)
    assert result.sample_step_m == 80.0
    assert result.assessment_radius_m == 250.0
    assert result.target_radius_m == 50.0
    assert result.passing_target_centers > 0
    assert result.best_target is not None
    assert result.best_target.slope_max_deg == pytest.approx(0.0, abs=1e-6)
    assert result.landing_safety_status == "UNVERIFIED"
    assert "NOT" in result.limitation or "No" in result.limitation
    assert all(t.cells_intersecting >= 1 for t in result.targets)


def test_incline_over_limit_rejects_all_targets() -> None:
    n = 101
    x = (np.arange(n, dtype=np.float64) - 50) * 80.0
    heights = (math.tan(math.radians(12.0)) * x[None, :]).repeat(n, axis=0)
    result = evaluate_landing_grid(
        dem_with(heights.astype(np.float32)), -90.0, 0.0, max_slope_deg=10.0
    )
    assert result.passing_target_centers == 0
    assert result.best_target is None
    assert all("terrain_slope_above_max" in t.reasons for t in result.targets)


def test_missing_terrain_never_passes_through_zero_filling() -> None:
    heights = np.zeros((101, 101), dtype=np.float32)
    heights[50, 50] = np.nan
    dem = dem_with(heights)
    with pytest.raises(ValueError, match=r"outside|missing"):
        evaluate_landing_grid(dem, -90.0, 0.0)


def test_incomplete_footprint_rejects_center_target() -> None:
    heights = np.zeros((101, 101), dtype=np.float32)
    heights[50, 52] = np.nan
    result = evaluate_landing_grid(dem_with(heights), -90.0, 0.0)
    center = next(t for t in result.targets if t.dx_m == 0 and t.dy_m == 0)
    assert center.terrain_screen_pass is False
    assert "terrain_incomplete" in center.reasons
    assert center.coverage_fraction < 1.0


def test_invalid_radius_or_thresholds_are_rejected() -> None:
    dem = dem_with(np.zeros((101, 101), dtype=np.float32))
    with pytest.raises(ValueError, match="target radius"):
        evaluate_landing_grid(dem, -90.0, 0.0, target_radius_m=250.0)
    with pytest.raises(ValueError, match="parameters"):
        evaluate_landing_grid(dem, -90.0, 0.0, max_slope_deg=-1.0)
    with pytest.raises(ValueError, match="nonnegative"):
        evaluate_landing_grid(dem, -90.0, 0.0, max_roughness_m=-1.0)
