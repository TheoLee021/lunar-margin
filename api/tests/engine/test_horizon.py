import math

import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.horizon import HorizonProfile, horizon_profile
from lunar_margin.pipeline.pds_label import PolarGridLabel

N = 401  # 100 m 격자, 중심 인덱스 200 → 극에서 ±20 km
C = 200


def make_dem(heights_km: NDArray[np.float32] | None = None) -> PolarDem:
    label = PolarGridLabel(N, N, 100.0, float(C), float(C), 1737.4, 1737.4, -90.0)
    data = heights_km if heights_km is not None else np.zeros((N, N), dtype=np.float32)
    return PolarDem(data, label)


def profile(dem: PolarDem, **kwargs: float) -> HorizonProfile:
    return horizon_profile(dem, -90.0, 0.0, max_range_m=15_000.0, **kwargs)


def north_wall() -> NDArray[np.float32]:
    heights = np.zeros((N, N), dtype=np.float32)
    heights[C - 100, C - 10 : C + 11] = 1.0  # 북쪽 10 km, 폭 2 km, 높이 1000 m
    return heights


def test_flat_dem_horizon_is_slightly_below_zero() -> None:
    result = profile(make_dem())

    assert np.all(result.elevation_deg <= 0.0)
    assert np.all(result.elevation_deg > -1.0)


def test_wall_at_distance_matches_atan() -> None:
    result = profile(make_dem(north_wall()))

    north = float(result.at(np.array([0.0]))[0])
    expected = math.degrees(math.atan(1000.0 / 10_000.0))
    assert north == pytest.approx(expected, abs=0.2)
    assert north < expected  # 달 곡률이 약간 낮춘다


def test_wall_does_not_affect_other_azimuths() -> None:
    result = profile(make_dem(north_wall()))

    assert float(result.at(np.array([90.0]))[0]) < 0.0
    assert float(result.at(np.array([180.0]))[0]) < 0.0


def test_east_wall_raises_azimuth_90_not_azimuth_0() -> None:
    heights = np.zeros((N, N), dtype=np.float32)
    heights[C - 10 : C + 11, C + 100] = 1.0  # 동쪽 10 km
    result = profile(make_dem(heights))

    assert float(result.at(np.array([90.0]))[0]) == pytest.approx(5.5, abs=0.2)
    assert float(result.at(np.array([0.0]))[0]) < 0.0


def test_observer_height_lowers_horizon() -> None:
    dem = make_dem(north_wall())

    on_ground = float(profile(dem).at(np.array([0.0]))[0])
    on_mast = float(profile(dem, observer_height_m=500.0).at(np.array([0.0]))[0])

    assert on_mast < on_ground
    assert on_mast == pytest.approx(math.degrees(math.atan(500.0 / 10_000.0)), abs=0.2)


def test_profile_at_wraps_around_360() -> None:
    result = profile(make_dem(north_wall()))

    assert float(result.at(np.array([360.0]))[0]) == pytest.approx(
        float(result.at(np.array([0.0]))[0])
    )
    assert float(result.at(np.array([-1.0]))[0]) == pytest.approx(
        float(result.at(np.array([359.0]))[0])
    )


def test_observer_outside_dem_raises() -> None:
    with pytest.raises(ValueError, match="outside"):
        horizon_profile(make_dem(), -80.0, 0.0)


def test_nan_pixels_are_ignored_not_treated_as_zero() -> None:
    heights = north_wall()
    heights[C - 50, C - 10 : C + 11] = np.nan  # 벽 앞에 결측선
    result = profile(make_dem(heights))

    assert float(result.at(np.array([0.0]))[0]) == pytest.approx(5.55, abs=0.2)


def test_azimuth_grid_follows_step() -> None:
    result = profile(make_dem(), azimuth_step_deg=10.0)

    assert result.azimuth_deg.tolist() == list(np.arange(0.0, 360.0, 10.0))
