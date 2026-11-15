"""햇빛 지도: 태양 방향 하나에 대해 격자 각 지점에서 보이는 태양 원반의 비율."""

import math

import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.sunlight import GridWindow, SunlightGrid, sunlit_fraction
from lunar_margin.pipeline.pds_label import PolarGridLabel

N, C = 401, 200  # 100 m 격자, 극에서 +-20 km
GRID = SunlightGrid(pixel_size_m=100.0, center_px=50)  # 극에서 +-5 km


def make_dem(heights_km: NDArray[np.float32] | None = None) -> PolarDem:
    label = PolarGridLabel(N, N, 100.0, float(C), float(C), 1737.4, 1737.4, -90.0)
    data = heights_km if heights_km is not None else np.zeros((N, N), dtype=np.float32)
    return PolarDem(data, label)


def sun_from(azimuth_deg: float, elevation_deg: float) -> tuple[float, float, float]:
    """극에서 본 방위각(0° = 경도 0° 쪽, 90° = 경도 90°E 쪽)과 고도의 태양 방향 (MOON_ME)."""
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    # 남극에서 위쪽은 -Z, 경도 0°는 +X, 경도 90°E는 +Y
    return (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), -math.sin(el))


def at(image: NDArray[np.float32], x_m: float, y_m: float) -> float:
    """규약: 픽셀 (col, row) = (center + x/px, center - y/px). x는 경도 90°E, y는 경도 0° 쪽."""
    col = GRID.center_px + round(x_m / GRID.pixel_size_m)
    row = GRID.center_px - round(y_m / GRID.pixel_size_m)
    return float(image[row, col])


def test_the_image_covers_the_grid_with_fractions_between_zero_and_one() -> None:
    image = sunlit_fraction(make_dem(), sun_from(0.0, 1.0), GRID, reach_m=5_000.0)

    assert image.shape == (101, 101)
    assert image.min() >= 0.0 and image.max() <= 1.0


def test_on_a_smooth_sphere_the_terminator_follows_the_curvature() -> None:
    # 태양 중심이 극의 지평선에 걸려 있다. 매끈한 구에서는 태양 쪽으로 d만큼 가면
    # 태양이 d/R 라디안 올라온다: 5 km -> 0.165°, 태양 반지름 0.2665°의 0.62배
    image = sunlit_fraction(make_dem(), sun_from(0.0, 0.0), GRID, reach_m=5_000.0)

    assert at(image, 0.0, 0.0) == pytest.approx(0.5, abs=0.06)  # 원반의 절반
    assert at(image, 0.0, 5_000.0) == pytest.approx(0.87, abs=0.06)  # 원반 대부분이 지평선 위
    assert at(image, 0.0, -5_000.0) == pytest.approx(0.13, abs=0.06)
    assert at(image, 5_000.0, 0.0) == pytest.approx(0.5, abs=0.06)  # 옆으로 가면 그대로


@pytest.mark.parametrize("azimuth_deg", [0.0, 90.0, 217.0])
def test_a_ridge_casts_a_shadow_as_long_as_its_height_over_tan_elevation(
    azimuth_deg: float,
) -> None:
    # 극에서 태양 쪽으로 1.85~2.15 km 떨어진 곳에, 태양 방향에 수직인 높이 100 m 둑.
    # 고도 5°이면 그림자는 둑 뒤쪽 끝(1.85 km)에서 100 / tan 5° = 1143 m 이어진다
    rows, cols = np.mgrid[0:N, 0:N]
    x_m, y_m = (cols - C) * 100.0, (C - rows) * 100.0
    az = math.radians(azimuth_deg)
    towards_sun = x_m * math.sin(az) + y_m * math.cos(az)
    heights = np.where(np.abs(towards_sun - 2_000.0) < 150.0, 0.1, 0.0).astype(np.float32)

    image = sunlit_fraction(make_dem(heights), sun_from(azimuth_deg, 5.0), GRID, reach_m=5_000.0)

    def along(distance_m: float) -> float:
        return at(image, distance_m * math.sin(az), distance_m * math.cos(az))

    assert along(1_400.0) == pytest.approx(0.0, abs=0.01)  # 둑 뒤 450 m: 그림자 안
    assert along(300.0) == pytest.approx(1.0, abs=0.01)  # 둑 뒤 1550 m: 그림자 밖
    assert along(2_700.0) == pytest.approx(1.0, abs=0.01)  # 둑 앞(태양 쪽)


def test_terrain_beyond_the_grid_still_casts_its_shadow_into_it() -> None:
    # 격자(+-5 km) 밖, 태양 쪽 9 km에 높이 1 km 벽: 고도 5°에서 그림자 길이 11.4 km
    heights = np.zeros((N, N), dtype=np.float32)
    heights[C - 90, :] = 1.0

    lit = sunlit_fraction(make_dem(), sun_from(0.0, 5.0), GRID, reach_m=12_000.0)
    shadowed = sunlit_fraction(make_dem(heights), sun_from(0.0, 5.0), GRID, reach_m=12_000.0)

    assert at(lit, 0.0, 3_000.0) == pytest.approx(1.0, abs=0.01)
    assert at(shadowed, 0.0, 3_000.0) == pytest.approx(0.0, abs=0.01)
    assert at(shadowed, 4_000.0, -1_000.0) == pytest.approx(0.0, abs=0.01)


def test_a_sun_straight_overhead_is_rejected() -> None:
    # 수평 성분이 없으면 햇빛이 오는 방위가 정해지지 않는다 (극에서는 일어나지 않는 경우)
    with pytest.raises(ValueError, match="horizontal"):
        sunlit_fraction(make_dem(), (0.0, 0.0, -1.0), GRID)


# 극에서 벗어난 창: 25 m 격자(극에서 +-20 km)에서 (6 km, 4 km)를 중심으로 한 가로 6 km, 세로 5 km
FINE = SunlightGrid(pixel_size_m=25.0, center_px=800)
WINDOW = GridWindow(col=800 + 120, row=800 - 260, width_px=240, height_px=200)
WINDOW_CENTRE_M = (6_000.0, 4_000.0)


def in_window(image: NDArray[np.float32], x_m: float, y_m: float) -> float:
    col = FINE.center_px + round(x_m / FINE.pixel_size_m) - WINDOW.col
    row = FINE.center_px - round(y_m / FINE.pixel_size_m) - WINDOW.row
    return float(image[row, col])


@pytest.mark.parametrize("azimuth_deg", [0.0, 90.0, 217.0])
def test_a_window_away_from_the_pole_shows_the_shadows_that_fall_inside_it(
    azimuth_deg: float,
) -> None:
    # 창 중심에서 태양 쪽으로 850~1150 m 떨어진 곳에, 태양 방향에 수직인 높이 100 m 둑.
    # 고도 5°이면 그림자는 둑 뒤쪽 끝에서 100 / tan 5° = 1143 m 이어진다
    # (창이 극에서 7 km 떨어져 있어 그곳의 태양 고도는 5°에서 0.24°까지 다르다: 그림자 길이 +-60 m)
    rows, cols = np.mgrid[0:N, 0:N]
    x_m, y_m = (cols - C) * 100.0, (C - rows) * 100.0
    az = math.radians(azimuth_deg)
    centre_x, centre_y = WINDOW_CENTRE_M
    towards_sun = (x_m - centre_x) * math.sin(az) + (y_m - centre_y) * math.cos(az)
    heights = np.where(np.abs(towards_sun - 1_000.0) < 150.0, 0.1, 0.0).astype(np.float32)

    image = sunlit_fraction(
        make_dem(heights), sun_from(azimuth_deg, 5.0), FINE, window=WINDOW, reach_m=5_000.0
    )

    def along(distance_m: float) -> float:
        return in_window(
            image, centre_x + distance_m * math.sin(az), centre_y + distance_m * math.cos(az)
        )

    assert image.shape == (200, 240)
    assert along(400.0) == pytest.approx(0.0, abs=0.01)  # 둑 뒤 450 m: 그림자 안
    assert along(-700.0) == pytest.approx(1.0, abs=0.01)  # 둑 뒤 1550 m: 그림자 밖
    assert along(1_700.0) == pytest.approx(1.0, abs=0.01)  # 둑 앞(태양 쪽)


def test_terrain_outside_a_window_still_casts_its_shadow_into_it() -> None:
    # 창(y 1.5~6.5 km) 밖, 태양 쪽 y = 12 km에 높이 1 km 벽: 고도 5°에서 그림자 길이 11.4 km
    heights = np.zeros((N, N), dtype=np.float32)
    heights[C - 120, :] = 1.0
    sun = sun_from(0.0, 5.0)

    lit = sunlit_fraction(make_dem(), sun, FINE, window=WINDOW, reach_m=12_000.0)
    shadowed = sunlit_fraction(make_dem(heights), sun, FINE, window=WINDOW, reach_m=12_000.0)

    assert in_window(lit, 6_000.0, 4_000.0) == pytest.approx(1.0, abs=0.01)
    assert in_window(shadowed, 6_000.0, 4_000.0) == pytest.approx(0.0, abs=0.01)
    assert in_window(shadowed, 8_500.0, 5_000.0) == pytest.approx(0.0, abs=0.01)


def test_far_from_the_pole_the_day_side_is_lit_and_the_night_side_is_dark() -> None:
    # 60°S까지 닿는 거친 격자(10 km, 극에서 +-930 km), 매끈한 구. 태양 중심이 극의 지평선에 걸려
    # 경도 0° 쪽에 있으면, 그쪽으로 300 km(위도 약 80°S)만 가도 태양이 10° 떠 있고 반대쪽은 밤이다
    label = PolarGridLabel(201, 201, 10_000.0, 100.0, 100.0, 1737.4, 1737.4, -90.0)
    dem = PolarDem(np.zeros((201, 201), dtype=np.float32), label)
    grid = SunlightGrid(pixel_size_m=10_000.0, center_px=93)

    image = sunlit_fraction(dem, sun_from(0.0, 0.0), grid)

    def towards_sun(distance_m: float) -> float:
        return float(image[grid.center_px - round(distance_m / grid.pixel_size_m), grid.center_px])

    assert towards_sun(300_000.0) == 1.0
    assert towards_sun(900_000.0) == 1.0  # 위도 약 61°S, 태양 고도 약 29°
    assert towards_sun(-300_000.0) == 0.0
    assert towards_sun(-900_000.0) == 0.0
