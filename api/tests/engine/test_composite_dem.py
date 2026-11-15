import numpy as np
import pytest

from lunar_margin.engine.dem import CompositeDem, PolarDem
from lunar_margin.engine.horizon import horizon_profile
from lunar_margin.pipeline.pds_label import PolarGridLabel


def make_dem(half_cells: int, scale_m: float, height_km: float) -> PolarDem:
    n = 2 * half_cells + 1
    label = PolarGridLabel(
        n, n, scale_m, float(half_cells), float(half_cells), 1737.4, 1737.4, -90.0
    )
    return PolarDem(np.full((n, n), height_km, dtype=np.float32), label)


@pytest.fixture
def composite() -> CompositeDem:
    primary = make_dem(100, 100.0, 0.1)  # 극에서 +-10 km, 고도 100 m
    fallback = make_dem(100, 200.0, 0.3)  # 극에서 +-20 km, 고도 300 m
    return CompositeDem(primary, fallback)


def test_values_come_from_the_primary_inside_its_extent(composite: CompositeDem) -> None:
    sample = composite.sample_height_m(np.array([0.0, 5000.0]), np.array([0.0, 5000.0]))

    assert sample == pytest.approx([100.0, 100.0])  # 높이는 float32로 저장된다


def test_values_come_from_the_fallback_outside_the_primary(composite: CompositeDem) -> None:
    sample = composite.sample_height_m(np.array([15000.0]), np.array([0.0]))

    assert sample[0] == pytest.approx(300.0)


def test_outside_both_is_missing_not_zero(composite: CompositeDem) -> None:
    sample = composite.sample_height_m(np.array([30000.0]), np.array([0.0]))

    assert np.isnan(sample[0])


def test_lonlat_sampling_uses_the_same_rule(composite: CompositeDem) -> None:
    near = composite.sample_height_lonlat_m(np.array([-89.99]), np.array([40.0]))  # 약 1 km
    far = composite.sample_height_lonlat_m(np.array([-89.8]), np.array([40.0]))  # 약 6 km, 안쪽
    outer = composite.sample_height_lonlat_m(np.array([-89.55]), np.array([40.0]))  # 약 13.6 km

    assert near[0] == pytest.approx(100.0) and far[0] == pytest.approx(100.0)
    assert outer[0] == pytest.approx(300.0)


def test_height_at_falls_back_and_raises_only_when_both_miss(composite: CompositeDem) -> None:
    assert composite.height_at(-89.55, 40.0) == pytest.approx(300.0)
    with pytest.raises(ValueError, match="outside"):
        composite.height_at(-89.0, 40.0)


def test_geometry_comes_from_the_primary(composite: CompositeDem) -> None:
    assert composite.radius_m == 1_737_400.0
    assert composite.label.map_scale_m == 100.0  # 수평선 탐색 간격의 기준


def test_a_primary_nan_pixel_is_filled_from_the_fallback() -> None:
    primary = make_dem(100, 100.0, 0.1)
    heights = np.array(primary._h)  # pyright: ignore[reportPrivateUsage]
    heights[100, 100] = np.nan
    holey = PolarDem(heights, primary.label)
    both = CompositeDem(holey, make_dem(100, 200.0, 0.3))

    assert both.sample_height_m(np.array([0.0]), np.array([0.0]))[0] == pytest.approx(300.0)


def test_horizon_is_complete_with_the_fallback_but_not_without_it() -> None:
    primary = make_dem(100, 100.0, 0.0)
    fallback = make_dem(100, 200.0, 0.0)
    site = (-89.9, 0.0)  # 극에서 약 3 km

    alone = horizon_profile(primary, *site, max_range_m=15_000.0)
    joined = horizon_profile(CompositeDem(primary, fallback), *site, max_range_m=15_000.0)

    assert alone.complete is False and joined.complete is True
