from datetime import UTC, datetime

import numpy as np
import pytest

from lunar_margin.engine.ephemeris import body_azel, utc_range

START = datetime(2027, 1, 1, tzinfo=UTC)


@pytest.mark.usefixtures("spice_kernels")
def test_utc_range_excludes_end_and_uses_step() -> None:
    et = utc_range(START, datetime(2027, 1, 2, tzinfo=UTC), 30)

    assert len(et) == 48
    assert np.allclose(np.diff(et), 1800.0)


@pytest.mark.usefixtures("spice_kernels")
def test_utc_range_rejects_empty_or_naive() -> None:
    with pytest.raises(ValueError, match="end"):
        utc_range(START, START, 30)
    with pytest.raises(ValueError, match="timezone"):
        utc_range(datetime(2027, 1, 1), datetime(2027, 1, 2, tzinfo=UTC), 30)


@pytest.mark.usefixtures("spice_kernels")
def test_sun_elevation_at_south_pole_is_small() -> None:
    et = utc_range(START, datetime(2028, 1, 1, tzinfo=UTC), 180)

    _, elevation = body_azel("SUN", -90.0, 0.0, et)

    assert np.abs(elevation).max() <= 1.6  # 달 자전축 경사 약 1.54°
    assert np.abs(elevation).max() > 1.0  # 그래도 0은 아니다


@pytest.mark.usefixtures("spice_kernels")
def test_sun_elevation_at_equator_swings_through_full_range() -> None:
    et = utc_range(START, datetime(2027, 2, 1, tzinfo=UTC), 60)

    _, elevation = body_azel("SUN", 0.0, 0.0, et)

    assert elevation.min() < -80.0
    assert elevation.max() > 80.0


@pytest.mark.usefixtures("spice_kernels")
def test_earth_always_high_at_near_side_center() -> None:
    et = utc_range(START, datetime(2028, 1, 1, tzinfo=UTC), 360)

    _, elevation = body_azel("EARTH", 0.0, 0.0, et)

    assert elevation.min() > 50.0


@pytest.mark.usefixtures("spice_kernels")
def test_earth_never_visible_from_far_side_center() -> None:
    et = utc_range(START, datetime(2028, 1, 1, tzinfo=UTC), 360)

    _, elevation = body_azel("EARTH", 0.0, 180.0, et)

    assert elevation.max() < 0.0


@pytest.mark.usefixtures("spice_kernels")
def test_azimuth_in_range_and_sun_rises_in_east() -> None:
    et = utc_range(START, datetime(2027, 1, 20, tzinfo=UTC), 30)

    azimuth, elevation = body_azel("SUN", 0.0, 0.0, et)

    assert azimuth.min() >= 0.0
    assert azimuth.max() < 360.0
    rising = np.where((elevation[:-1] < 0) & (elevation[1:] >= 0))[0]
    assert len(rising) >= 1
    # 달은 서→동으로 자전하므로 태양은 동쪽(방위각 ≈ 90°)에서 뜬다
    assert np.all(np.abs(azimuth[rising] - 90.0) < 5.0)
