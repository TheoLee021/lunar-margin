import math

import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.engine.dem import PolarDem
from lunar_margin.pipeline.pds_label import PolarGridLabel

N = 101  # 중심 픽셀 인덱스 50, 픽셀 간격 100 m


def make_dem(heights_km: NDArray[np.float32] | None = None) -> PolarDem:
    label = PolarGridLabel(
        lines=N,
        samples=N,
        map_scale_m=100.0,
        line_offset=50.0,
        sample_offset=50.0,
        radius_km=1737.4,
        height_offset_km=1737.4,
        center_lat_deg=-90.0,
    )
    data = heights_km if heights_km is not None else np.zeros((N, N), dtype=np.float32)
    return PolarDem(data, label)


def test_pole_maps_to_grid_center() -> None:
    x, y = make_dem().lonlat_to_xy(-90.0, 0.0)

    assert (x, y) == pytest.approx((0.0, 0.0), abs=1e-6)


def test_lon_0_is_up_and_lon_90_is_right() -> None:
    dem = make_dem()
    one_km_lat = -90.0 + math.degrees(1000.0 / 1_737_400.0)

    x0, y0 = dem.lonlat_to_xy(one_km_lat, 0.0)
    x90, y90 = dem.lonlat_to_xy(one_km_lat, 90.0)

    assert (x0, y0) == pytest.approx((0.0, 1000.0), rel=1e-3)
    assert (x90, y90) == pytest.approx((1000.0, 0.0), abs=1.0, rel=1e-3)


def test_height_at_flat_grid_is_constant() -> None:
    dem = make_dem(np.full((N, N), 0.25, dtype=np.float32))

    assert dem.height_at(-89.99, 30.0) == pytest.approx(250.0)


def test_image_row_decreases_with_y() -> None:
    heights = np.zeros((N, N), dtype=np.float32)
    heights[40, 50] = 1.0  # 중심에서 위로 10픽셀 = y +1000 m = 경도 0 방향
    dem = make_dem(heights)

    up = dem.sample_height_m(np.array([0.0]), np.array([1000.0]))
    down = dem.sample_height_m(np.array([0.0]), np.array([-1000.0]))

    assert up[0] == pytest.approx(1000.0)
    assert down[0] == pytest.approx(0.0)


def test_bilinear_interpolates_between_pixels() -> None:
    heights = np.zeros((N, N), dtype=np.float32)
    heights[50, 50] = 0.0
    heights[50, 51] = 1.0  # +1 km
    dem = make_dem(heights)

    mid = dem.sample_height_m(np.array([50.0]), np.array([0.0]))

    assert mid[0] == pytest.approx(500.0)


def test_outside_grid_returns_nan_and_height_at_raises() -> None:
    dem = make_dem()

    outside = dem.sample_height_m(np.array([1e6]), np.array([0.0]))

    assert np.isnan(outside[0])
    assert not dem.contains(-80.0, 0.0)
    with pytest.raises(ValueError, match="outside"):
        dem.height_at(-80.0, 0.0)


def test_nan_pixel_makes_sample_nan() -> None:
    heights = np.zeros((N, N), dtype=np.float32)
    heights[50, 50] = np.nan

    sample = make_dem(heights).sample_height_m(np.array([0.0]), np.array([0.0]))

    assert np.isnan(sample[0])
