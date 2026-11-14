import math

import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.site_characteristics import (
    characterize_site,
    characterize_region,
    local_roughness_rms_m,
    local_slope_deg,
)
from lunar_margin.pipeline.pds_label import PolarGridLabel

N = 101
C = 50
SCALE_M = 100.0


def make_dem(heights_m: NDArray[np.float32]) -> PolarDem:
    label = PolarGridLabel(
        lines=N,
        samples=N,
        map_scale_m=SCALE_M,
        line_offset=float(C),
        sample_offset=float(C),
        radius_km=1737.4,
        height_offset_km=1737.4,
        center_lat_deg=-90.0,
    )
    return PolarDem((heights_m / 1000.0).astype(np.float32), label)


def xy_grid() -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    cols = np.arange(N, dtype=np.float64)
    rows = np.arange(N, dtype=np.float64)
    x = (cols - C) * SCALE_M
    y = (C - rows) * SCALE_M
    return np.meshgrid(x, y)


def test_flat_dem_has_zero_slope_and_roughness() -> None:
    dem = make_dem(np.full((N, N), 250.0, dtype=np.float32))

    result = characterize_site(dem, -90.0, 0.0)

    assert result.elevation_m == pytest.approx(250.0)
    assert result.slope_deg == pytest.approx(0.0, abs=1e-6)
    assert result.roughness_rms_m == pytest.approx(0.0, abs=1e-5)
    assert result.slope_baseline_m == SCALE_M
    assert result.roughness_window_m == 100.0


def test_planar_surface_reports_expected_slope_but_zero_roughness() -> None:
    x, _ = xy_grid()
    grade = math.tan(math.radians(10.0))
    heights = (grade * x).astype(np.float32)
    dem = make_dem(heights)

    assert local_slope_deg(dem, -90.0, 0.0) == pytest.approx(10.0, abs=0.05)
    assert local_roughness_rms_m(dem, -90.0, 0.0, window_m=400.0) == pytest.approx(0.0, abs=1e-4)


def test_bump_increases_roughness() -> None:
    heights = np.zeros((N, N), dtype=np.float32)
    heights[C, C] = 10.0
    dem = make_dem(heights)

    roughness = local_roughness_rms_m(dem, -90.0, 0.0, window_m=400.0, samples_per_axis=5)

    assert roughness > 1.0


def test_invalid_scales_are_rejected() -> None:
    dem = make_dem(np.zeros((N, N), dtype=np.float32))

    with pytest.raises(ValueError, match="baseline"):
        local_slope_deg(dem, -90.0, 0.0, baseline_m=0.0)
    with pytest.raises(ValueError, match="window"):
        local_roughness_rms_m(dem, -90.0, 0.0, window_m=0.0)
    with pytest.raises(ValueError, match="samples_per_axis"):
        local_roughness_rms_m(dem, -90.0, 0.0, samples_per_axis=2)


def test_circular_region_on_flat_dem_is_complete_and_level() -> None:
    dem = make_dem(np.zeros((N, N), dtype=np.float32))
    region = characterize_region(dem, -90.0, 0.0, radius_m=250.0)
    assert region.total_samples == 21
    assert region.valid_samples == region.total_samples
    assert region.coverage_fraction == 1.0
    assert region.sample_step_m == 100.0
    assert region.slope_p95_deg == pytest.approx(0.0, abs=1e-6)
    assert region.slope_max_deg == pytest.approx(0.0, abs=1e-6)
    assert region.roughness_p95_m == pytest.approx(0.0, abs=1e-5)


def test_circular_region_slope_detects_incline() -> None:
    x, _ = xy_grid()
    dem = make_dem((math.tan(math.radians(12.0)) * x).astype(np.float32))
    region = characterize_region(dem, -90.0, 0.0)
    assert region.coverage_fraction == 1.0
    assert region.slope_p95_deg == pytest.approx(12.0, abs=0.05)


def test_circular_region_missing_dem_samples_reduce_coverage() -> None:
    heights = np.zeros((N, N), dtype=np.float32)
    heights[C, C + 1] = np.nan
    dem = make_dem(heights)
    region = characterize_region(dem, -90.0, 0.0)
    assert 0 < region.coverage_fraction < 1
    assert region.valid_samples < region.total_samples


def test_circular_region_rejects_nonpositive_radius() -> None:
    dem = make_dem(np.zeros((N, N), dtype=np.float32))
    with pytest.raises(ValueError, match="radius"):
        characterize_region(dem, -90.0, 0.0, radius_m=0)
