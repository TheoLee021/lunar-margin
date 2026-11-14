"""Pure-data test: one terrain horizon shared by SUN and EARTH metrics."""
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from lunar_margin.app import site_assessment as module
from lunar_margin.app.settings import Settings
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.horizon import HorizonProfile
from lunar_margin.pipeline.pds_label import PolarGridLabel


def test_combined_candidate_uses_single_horizon_and_real_mask_logic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    label = PolarGridLabel(
        lines=101,
        samples=101,
        map_scale_m=100.0,
        line_offset=50.0,
        sample_offset=50.0,
        radius_km=1737.4,
        height_offset_km=1737.4,
        center_lat_deg=-90.0,
    )
    dem = PolarDem(np.zeros((101, 101), dtype=np.float32), label)
    start = datetime(2027, 1, 10, tzinfo=UTC)
    times = np.arange(4, dtype=np.float64)
    calls: list[str] = []
    terrain_calls: list[int] = []

    def fake_horizon(
        _dem: PolarDem,
        _lat: float,
        _lon: float,
        *,
        azimuth_step_deg: float,
        step_m: float,
    ) -> HorizonProfile:
        terrain_calls.append(1)
        assert azimuth_step_deg == 2.0
        assert step_m == 160.0
        return HorizonProfile(
            azimuth_deg=np.array([0.0, 180.0]),
            elevation_deg=np.array([0.0, 0.0]),
        )

    def fake_azel(
        body: str,
        _lat: float,
        _lon: float,
        _times: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        calls.append(body)
        return (
            np.zeros(4),
            np.array([1.0, 1.0, -1.0, -1.0])
            if body == "SUN"
            else np.array([1.0, -1.0, 1.0, -1.0]),
        )

    monkeypatch.setattr(module, "_load_dem", lambda _path: dem)
    monkeypatch.setattr(module, "horizon_profile", fake_horizon)
    monkeypatch.setattr(module, "utc_range", lambda *_: times)
    monkeypatch.setattr(module, "body_azel", fake_azel)

    assessor = module.get_site_assessor(Settings(data_dir=Path("unused")))
    result = assessor(
        module.SiteQuery(
            lat=-90.0,
            lon=0.0,
            start=start,
            end=start + timedelta(hours=2),
            step_minutes=30,
        )
    )
    assert terrain_calls == [1]
    assert calls == ["SUN", "EARTH"]
    assert result.sun.visible_fraction == pytest.approx(0.5)
    assert result.sun.longest_dark_hours == pytest.approx(1.0)
    assert result.earth.visible_fraction == pytest.approx(0.5)
    assert result.earth.longest_dark_hours == pytest.approx(0.5)
    assert result.terrain.slope_deg == pytest.approx(0.0)
    assert result.terrain.roughness_rms_m == pytest.approx(0.0)
