from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from lunar_margin.engine.candidates.config import AnalysisWindow
from lunar_margin.engine.candidates.field import FieldSettings, compute_field
from lunar_margin.engine.candidates.grid import SitePoints
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.metrics import analyze_site
from lunar_margin.pipeline.pds_label import PolarGridLabel

N, C = 401, 200  # 100 m 격자, 극에서 +-20 km


def synthetic_dem(ridge: bool = True) -> PolarDem:
    label = PolarGridLabel(N, N, 100.0, float(C), float(C), 1737.4, 1737.4, -90.0)
    heights = np.zeros((N, N), dtype=np.float32)
    if ridge:
        yy, xx = np.mgrid[0:N, 0:N]
        radius_px = np.hypot(yy - C, xx - C)
        heights[(radius_px >= 100) & (radius_px <= 105)] = 0.3  # 10 km 밖 300 m 능선
        heights[(xx > 230) & (xx < 260) & (yy > 180) & (yy < 220)] = 0.5  # 동쪽 언덕
    return PolarDem(heights, label)


def sites_at(coords: list[tuple[float, float]]) -> SitePoints:
    from lunar_margin.engine.candidates.projection import lonlat_to_polar_xy

    lat = np.array([c[0] for c in coords])
    lon = np.array([c[1] for c in coords])
    x, y = lonlat_to_polar_xy(lat, lon)
    zeros = np.zeros(len(coords), dtype=np.int64)
    return SitePoints(zeros, zeros, x, y, lat, lon, 500.0, "test")


WINDOW = AnalysisWindow(
    start=datetime(2027, 1, 1, tzinfo=UTC), end=datetime(2027, 3, 1, tzinfo=UTC), step_minutes=60
)


def settings(**overrides: float) -> FieldSettings:
    base = {"azimuth_step_deg": 1.0, "max_range_m": 200_000.0, "observer_height_m": 0.0}
    return FieldSettings(window=WINDOW, **{**base, **overrides})  # pyright: ignore[reportArgumentType]


@pytest.mark.usefixtures("spice_kernels")
def test_field_matches_analyze_site_for_both_bodies() -> None:
    dem = synthetic_dem()
    coords = [(-90.0, 0.0), (-89.95, 40.0), (-89.9, 200.0)]

    field = compute_field(dem, sites_at(coords), settings())

    for k, (lat, lon) in enumerate(coords):
        sun = analyze_site(dem, lat, lon, "SUN", WINDOW.start, WINDOW.end, 60).metrics
        earth = analyze_site(dem, lat, lon, "EARTH", WINDOW.start, WINDOW.end, 60).metrics
        assert field.sun_fraction[k] == pytest.approx(sun.visible_fraction)
        assert field.sun_longest_dark_h[k] == pytest.approx(sun.longest_dark_hours)
        assert field.sun_windows_per_24h[k] == pytest.approx(sun.windows_per_24h)
        assert field.earth_fraction[k] == pytest.approx(earth.visible_fraction)
        assert field.earth_longest_blackout_h[k] == pytest.approx(earth.longest_dark_hours)
        expected = np.nan if sun.mean_elevation_deg is None else sun.mean_elevation_deg
        assert field.sun_mean_elevation_deg[k] == pytest.approx(expected, nan_ok=True)
        assert bool(field.computed[k])


@pytest.mark.usefixtures("spice_kernels")
def test_horizon_completeness_flag_follows_the_dem_extent() -> None:
    sites = sites_at([(-90.0, 0.0)])

    inside = compute_field(synthetic_dem(), sites, settings(max_range_m=10_000.0))
    too_far = compute_field(synthetic_dem(), sites, settings(max_range_m=60_000.0))

    assert bool(inside.horizon_complete[0]) and not bool(too_far.horizon_complete[0])
    assert bool(too_far.computed[0])  # 불완전해도 값은 계산된다 (DEM 안쪽 구간 기준)


@pytest.mark.usefixtures("spice_kernels")
def test_site_outside_the_dem_is_missing_not_zero() -> None:
    far = sites_at([(-89.0, 0.0)])  # 극에서 약 30 km: 20 km짜리 DEM 밖

    field = compute_field(synthetic_dem(), far, settings())

    assert not bool(field.computed[0]) and not bool(field.horizon_complete[0])
    assert np.isnan(field.sun_fraction[0]) and np.isnan(field.earth_fraction[0])


@pytest.mark.usefixtures("spice_kernels")
def test_ridge_blocks_the_sun_and_open_ground_does_not() -> None:
    sites = sites_at([(-90.0, 0.0)])

    walled = compute_field(synthetic_dem(ridge=True), sites, settings(max_range_m=15_000.0))
    open_ground = compute_field(synthetic_dem(ridge=False), sites, settings(max_range_m=15_000.0))

    assert walled.sun_fraction[0] == 0.0
    assert 0.3 < open_ground.sun_fraction[0] < 0.7


@pytest.mark.usefixtures("spice_kernels")
def test_parallel_workers_give_exactly_the_same_result_as_one_process(data_dir: Path) -> None:
    dem_files = (
        data_dir / "dem" / "ldem_80s_80m_float.img",
        data_dir / "dem" / "ldem_80s_80m_float.lbl",
    )
    dem = PolarDem.from_files(*dem_files)
    coords = [(-89.5, 222.0), (-89.8, 210.0), (-88.1, 44.9), (-87.0, 100.0), (-89.99, 10.0)]
    short = FieldSettings(
        window=AnalysisWindow(
            start=datetime(2027, 1, 1, tzinfo=UTC),
            end=datetime(2027, 1, 20, tzinfo=UTC),
            step_minutes=120,
        ),
        azimuth_step_deg=2.0,
        max_range_m=200_000.0,
        observer_height_m=0.0,
    )

    one = compute_field(dem, sites_at(coords), short, workers=1)
    two = compute_field(dem, sites_at(coords), short, workers=2, dem_files=[dem_files])

    for name in ("sun_fraction", "earth_fraction", "sun_longest_dark_h", "horizon_max_deg"):
        assert np.array_equal(getattr(one, name), getattr(two, name), equal_nan=True), name
    assert np.array_equal(one.horizon_complete, two.horizon_complete)


def test_multiple_workers_require_dem_files() -> None:
    with pytest.raises(ValueError, match="dem_files"):
        compute_field(synthetic_dem(), sites_at([(-90.0, 0.0)]), settings(), workers=2)


@pytest.mark.usefixtures("spice_kernels")
def test_progress_is_reported_per_chunk_and_ends_at_the_total() -> None:
    events: list[tuple[int, int]] = []
    coords = [(-90.0, 0.0), (-89.99, 40.0), (-89.98, 90.0), (-89.97, 180.0), (-89.96, 270.0)]

    compute_field(
        synthetic_dem(),
        sites_at(coords),
        settings(max_range_m=10_000.0),
        chunk_size=2,
        on_progress=lambda done, total: events.append((done, total)),
    )

    assert events == [(2, 5), (4, 5), (5, 5)]


@pytest.mark.usefixtures("spice_kernels")
def test_chunking_does_not_change_the_result() -> None:
    coords = [(-90.0, 0.0), (-89.99, 40.0), (-89.98, 90.0), (-89.97, 180.0), (-89.96, 270.0)]
    sites = sites_at(coords)

    whole = compute_field(synthetic_dem(), sites, settings(max_range_m=10_000.0), chunk_size=64)
    pieces = compute_field(synthetic_dem(), sites, settings(max_range_m=10_000.0), chunk_size=2)

    for name in ("sun_fraction", "earth_fraction", "earth_longest_blackout_h", "horizon_max_deg"):
        assert np.array_equal(getattr(whole, name), getattr(pieces, name), equal_nan=True), name
