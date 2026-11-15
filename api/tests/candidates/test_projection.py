import math

import numpy as np
import pytest

from lunar_margin.engine.candidates.projection import (
    lonlat_to_polar_xy,
    polar_radius_m,
    polar_xy_to_lonlat,
)
from lunar_margin.engine.ephemeris import MOON_RADIUS_M


def test_pole_maps_to_origin_and_back() -> None:
    x, y = lonlat_to_polar_xy(np.array([-90.0]), np.array([0.0]))
    lat, _ = polar_xy_to_lonlat(np.array([0.0]), np.array([0.0]))

    assert (x[0], y[0]) == pytest.approx((0.0, 0.0), abs=1e-6)
    assert lat[0] == pytest.approx(-90.0)


def test_lon_0_is_plus_y_and_lon_90_is_plus_x() -> None:
    lat = -90.0 + math.degrees(1000.0 / MOON_RADIUS_M)  # 극에서 약 1 km

    x0, y0 = lonlat_to_polar_xy(np.array([lat, lat]), np.array([0.0, 90.0]))

    assert (x0[0], y0[0]) == pytest.approx((0.0, 1000.0), rel=1e-3, abs=0.5)
    assert (x0[1], y0[1]) == pytest.approx((1000.0, 0.0), rel=1e-3, abs=0.5)


def test_round_trip_over_the_whole_roi() -> None:
    rng = np.random.default_rng(0)
    lat = rng.uniform(-90.0, -80.0, 500)
    lon = rng.uniform(0.0, 360.0, 500)

    x, y = lonlat_to_polar_xy(lat, lon)
    lat2, lon2 = polar_xy_to_lonlat(x, y)

    assert np.allclose(lat, lat2, atol=1e-9)
    assert np.allclose(lon, lon2, atol=1e-9)


def test_longitude_is_returned_in_0_360() -> None:
    _, lon = polar_xy_to_lonlat(
        np.array([-1000.0, 1000.0, 0.0]), np.array([-1000.0, 1000.0, -1000.0])
    )

    assert np.all((lon >= 0.0) & (lon < 360.0))
    assert lon[0] == pytest.approx(225.0)
    assert lon[2] == pytest.approx(180.0)


def test_agrees_with_the_dem_projection() -> None:
    from lunar_margin.engine.dem import PolarDem
    from lunar_margin.pipeline.pds_label import PolarGridLabel

    label = PolarGridLabel(11, 11, 100.0, 5.0, 5.0, 1737.4, 1737.4, -90.0)
    dem = PolarDem(np.zeros((11, 11), dtype=np.float32), label)

    expected = dem.lonlat_to_xy(-89.7, 130.0)
    x, y = lonlat_to_polar_xy(np.array([-89.7]), np.array([130.0]))

    assert (x[0], y[0]) == pytest.approx(expected, abs=1e-6)


def test_polar_radius_matches_distance_for_small_colatitude() -> None:
    # 극에서 0.1° 떨어진 점의 거리는 약 R * 0.1° (입체투영은 극 부근에서 축척 1)
    assert polar_radius_m(-89.9) == pytest.approx(MOON_RADIUS_M * math.radians(0.1), rel=1e-5)
    assert polar_radius_m(-90.0) == 0.0
