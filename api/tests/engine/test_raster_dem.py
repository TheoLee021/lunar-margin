"""극 입체투영 평면의 사각형 고도 래스터 (5 m 지역 DEM)."""

import numpy as np
import pytest

from lunar_margin.engine.dem import RasterDem

# 왼쪽 위 모서리가 (x, y) = (-100, 50)인 3행 4열, 10 m 픽셀. 값 = 행 * 10 + 열
HEIGHTS = (np.arange(3)[:, None] * 10.0 + np.arange(4)[None, :]).astype(np.float32)


def dem() -> RasterDem:
    return RasterDem(HEIGHTS, left_m=-100.0, top_m=50.0, pixel_size_m=10.0)


def sample(raster: RasterDem, x: float, y: float) -> float:
    return float(raster.sample_height_m(np.array([x]), np.array([y]))[0])


def test_pixel_centres_return_the_stored_heights() -> None:
    # 픽셀 (행 0, 열 0)의 중심은 모서리에서 반 픽셀 안쪽, y는 아래로 갈수록 작아진다
    assert sample(dem(), -95.0, 45.0) == 0.0
    assert sample(dem(), -65.0, 45.0) == 3.0
    assert sample(dem(), -95.0, 25.0) == 20.0


def test_between_pixel_centres_heights_are_interpolated() -> None:
    assert sample(dem(), -90.0, 45.0) == pytest.approx(0.5)  # 열 0과 1의 중간
    assert sample(dem(), -95.0, 40.0) == pytest.approx(5.0)  # 행 0과 1의 중간
    assert sample(dem(), -90.0, 40.0) == pytest.approx(5.5)


def test_outside_the_outer_pixel_centres_there_is_no_height() -> None:
    raster = dem()
    for x, y in [(-96.0, 45.0), (-64.0, 45.0), (-95.0, 46.0), (-95.0, 24.0), (500.0, 500.0)]:
        assert np.isnan(sample(raster, x, y))


def test_a_missing_pixel_blanks_everything_interpolated_from_it() -> None:
    heights = HEIGHTS.copy()
    heights[1, 1] = np.nan
    raster = RasterDem(heights, left_m=-100.0, top_m=50.0, pixel_size_m=10.0)

    assert np.isnan(sample(raster, -85.0, 35.0))  # 그 픽셀의 중심
    assert np.isnan(sample(raster, -90.0, 40.0))  # 그 픽셀이 섞이는 지점
    assert sample(raster, -65.0, 45.0) == 3.0


def test_bounds_are_the_outer_pixel_centres() -> None:
    assert dem().bounds_m == (-95.0, 25.0, -65.0, 45.0)  # (x 최소, y 최소, x 최대, y 최대)
