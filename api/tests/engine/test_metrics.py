from datetime import UTC, datetime

import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.metrics import analyze_site, find_runs, summarize
from lunar_margin.pipeline.pds_label import PolarGridLabel


def mask(pattern: str) -> NDArray[np.bool_]:
    return np.array([c == "V" for c in pattern], dtype=np.bool_)


def test_find_runs_returns_half_open_index_ranges() -> None:
    assert find_runs(mask("VVDDV"), True) == [(0, 2), (4, 5)]
    assert find_runs(mask("VVDDV"), False) == [(2, 4)]
    assert find_runs(mask(""), True) == []


def test_all_visible() -> None:
    visible = np.ones(48, dtype=np.bool_)  # 24 h @ 30 min

    result = summarize(visible, 30, np.full(48, 2.0))

    assert result.visible_fraction == 1.0
    assert result.longest_dark_hours == 0.0
    assert result.windows_per_24h == pytest.approx(1.0)
    assert result.mean_elevation_deg == pytest.approx(2.0)


def test_all_dark() -> None:
    visible = np.zeros(48, dtype=np.bool_)

    result = summarize(visible, 30, np.full(48, -3.0))

    assert result.visible_fraction == 0.0
    assert result.longest_dark_hours == 24.0
    assert result.windows_per_24h == 0.0
    assert result.mean_elevation_deg is None


def test_alternating_6h_over_2_days() -> None:
    visible = np.tile(np.repeat([True, False], 12), 4)  # 6h 가시, 6h 암흑을 4번 반복

    result = summarize(visible, 30, np.full(96, 1.0))

    assert result.visible_fraction == pytest.approx(0.5)
    assert result.longest_dark_hours == pytest.approx(6.0)
    assert result.windows_per_24h == pytest.approx(2.0)


def test_dark_run_touching_start_and_end_counts() -> None:
    visible = mask("D" * 10 + "V" * 4 + "D" * 6)  # 시작 10칸·끝 6칸 암흑

    result = summarize(visible, 60, np.zeros(20))

    assert result.longest_dark_hours == 10.0
    assert result.windows_per_24h == pytest.approx(1 / (20 / 24))


def test_mean_elevation_only_over_visible_samples() -> None:
    visible = mask("VVDD")
    elevation = np.array([1.0, 3.0, -50.0, -50.0])

    assert summarize(visible, 60, elevation).mean_elevation_deg == pytest.approx(2.0)


def test_step_minutes_scales_hours() -> None:
    visible = mask("VDDDV")

    assert summarize(visible, 10, np.zeros(5)).longest_dark_hours == pytest.approx(0.5)
    assert summarize(visible, 120, np.zeros(5)).longest_dark_hours == pytest.approx(6.0)


def test_empty_series_raises() -> None:
    with pytest.raises(ValueError, match="empty"):
        summarize(np.zeros(0, dtype=np.bool_), 30, np.zeros(0))


def test_length_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="length"):
        summarize(mask("VV"), 30, np.zeros(3))


# --- 실제 SPICE + 합성 DEM ---------------------------------------------------

N = 401
C = 200


def pole_dem(ridge_height_km: float | None = None) -> PolarDem:
    label = PolarGridLabel(N, N, 100.0, float(C), float(C), 1737.4, 1737.4, -90.0)
    heights = np.zeros((N, N), dtype=np.float32)
    if ridge_height_km is not None:
        yy, xx = np.mgrid[0:N, 0:N]
        radius_px = np.hypot(yy - C, xx - C)
        heights[(radius_px >= 100) & (radius_px <= 105)] = ridge_height_km
    return PolarDem(heights, label)


YEAR = (datetime(2027, 1, 1, tzinfo=UTC), datetime(2028, 1, 1, tzinfo=UTC))


@pytest.mark.usefixtures("spice_kernels")
def test_flat_pole_sun_is_up_about_half_the_year() -> None:
    result = analyze_site(pole_dem(), -90.0, 0.0, "SUN", *YEAR, step_minutes=180)

    assert 0.45 < result.metrics.visible_fraction < 0.55
    assert len(result.visible) == len(result.times) == len(result.body_elevation_deg)


@pytest.mark.usefixtures("spice_kernels")
def test_ridge_ring_blocks_the_sun_entirely() -> None:
    # 10 km 밖 1 km 능선 → 수평선 약 5.5° > 태양 최대 고도 1.54°
    result = analyze_site(pole_dem(1.0), -90.0, 0.0, "SUN", *YEAR, step_minutes=180)

    assert result.metrics.visible_fraction == 0.0
    assert result.metrics.windows_per_24h == 0.0
    assert result.metrics.mean_elevation_deg is None
    assert result.metrics.longest_dark_hours == pytest.approx(365 * 24.0)


@pytest.mark.usefixtures("spice_kernels")
def test_series_times_cover_requested_range_for_earth() -> None:
    result = analyze_site(
        pole_dem(), -90.0, 0.0, "EARTH", datetime(2027, 1, 1, tzinfo=UTC),
        datetime(2027, 1, 31, tzinfo=UTC), step_minutes=60,
    )  # fmt: skip

    assert len(result.times) == 30 * 24
    assert result.times[0] == datetime(2027, 1, 1, tzinfo=UTC)
    assert result.horizon.elevation_deg.shape == result.horizon.azimuth_deg.shape
