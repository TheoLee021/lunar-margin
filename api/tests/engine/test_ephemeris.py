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


# --- 천체 벡터와 지점 투영의 분리 (SPICE 없이 검증 가능한 부분) ---------------------


def test_topocentric_azel_cardinal_directions() -> None:
    from lunar_margin.engine.ephemeris import topocentric_azel

    far = 1.0e9  # km: 관측점 오프셋(1737 km)이 방향에 영향을 주지 않을 만큼 먼 거리
    vectors = np.array(
        [
            [far, 0.0, 0.0],  # 위도 0, 경도 0 지점의 천정
            [-far, 0.0, 0.0],  # 천저
            [0.0, 0.0, far],  # 북쪽 지평선 방향
            [0.0, far, 0.0],  # 동쪽 지평선 방향
        ]
    )

    azimuth, elevation = topocentric_azel(vectors, 0.0, 0.0)

    assert elevation[0] == pytest.approx(90.0, abs=0.01)
    assert elevation[1] == pytest.approx(-90.0, abs=0.01)
    assert azimuth[2] == pytest.approx(0.0, abs=0.01)
    assert azimuth[3] == pytest.approx(90.0, abs=0.01)
    assert elevation[2] == pytest.approx(0.0, abs=0.01)
    assert elevation[3] == pytest.approx(0.0, abs=0.01)


def test_topocentric_azel_accepts_many_sites_with_one_vector_set() -> None:
    from lunar_margin.engine.ephemeris import topocentric_azel

    vectors = np.array([[1.0e9, 0.0, 0.0]])

    _, at_zenith = topocentric_azel(vectors, 0.0, 0.0)
    _, off_zenith = topocentric_azel(vectors, 0.0, 90.0)

    assert at_zenith[0] > 89.9
    assert off_zenith[0] == pytest.approx(0.0, abs=0.01)  # 경도 90°에서는 지평선 위치


@pytest.mark.usefixtures("spice_kernels")
def test_body_azel_equals_vectors_plus_projection() -> None:
    from lunar_margin.engine.ephemeris import body_vectors, topocentric_azel

    et = utc_range(START, datetime(2027, 1, 10, tzinfo=UTC), 60)

    vectors = body_vectors("SUN", et)
    az1, el1 = topocentric_azel(vectors, -89.5, 222.0, 2.0)
    az2, el2 = body_azel("SUN", -89.5, 222.0, et, 2.0)

    assert vectors.shape == (len(et), 3)
    assert np.allclose(az1, az2) and np.allclose(el1, el2)


@pytest.mark.usefixtures("spice_kernels")
def test_concurrent_requests_do_not_corrupt_each_other() -> None:
    """CSPICE는 스레드 안전하지 않다. 스레드풀에서 동시에 호출해도 안전해야 한다."""
    from concurrent.futures import ThreadPoolExecutor

    from lunar_margin.engine.ephemeris import body_vectors

    et = utc_range(START, datetime(2027, 3, 1, tzinfo=UTC), 60)
    expected = {body: body_vectors(body, et) for body in ("SUN", "EARTH")}  # 직렬 기준값

    def work(index: int) -> bool:
        body = "SUN" if index % 2 == 0 else "EARTH"
        local_et = utc_range(START, datetime(2027, 3, 1, tzinfo=UTC), 60)
        return bool(np.array_equal(body_vectors(body, local_et), expected[body]))

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(work, range(64)))

    assert all(results)
