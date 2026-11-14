from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from lunar_margin.engine.candidates.config import (
    AnalysisWindow,
    Roi,
    SearchConfig,
    Thresholds,
    Weights,
)


def test_defaults_are_the_agreed_initial_experiment() -> None:
    config = SearchConfig()

    assert (config.roi.min_lat_deg, config.roi.max_lat_deg) == (-90.0, -85.0)
    assert config.grid_spacing_m == 500.0
    assert config.min_separation_m == 2000.0
    assert config.top_k == 100
    assert config.thresholds == Thresholds()  # 모든 임계값 미설정: 분포를 본 뒤 정한다
    # 분석 기간 기본값: 월 궤도 승교점 주기(약 18.6년)를 덮는 19년, 60분 간격
    assert config.window.start == datetime(2027, 1, 1, tzinfo=UTC)
    assert config.window.end == datetime(2046, 1, 1, tzinfo=UTC)
    assert config.window.step_minutes == 60


def test_roi_must_be_an_ordered_south_polar_band() -> None:
    with pytest.raises(ValidationError):
        Roi(min_lat_deg=-85.0, max_lat_deg=-90.0)
    with pytest.raises(ValidationError):
        Roi(min_lat_deg=-90.0, max_lat_deg=10.0)
    with pytest.raises(ValidationError):
        Roi(min_lat_deg=-95.0, max_lat_deg=-85.0)


def test_coarse_spacing_must_be_a_whole_multiple_of_the_grid_spacing() -> None:
    with pytest.raises(ValidationError, match="multiple"):
        SearchConfig(grid_spacing_m=500.0, coarse_spacing_m=1250.0)
    with pytest.raises(ValidationError, match="coarse"):
        SearchConfig(grid_spacing_m=500.0, coarse_spacing_m=250.0)
    assert SearchConfig(grid_spacing_m=500.0, coarse_spacing_m=None).coarse_spacing_m is None


def test_thresholds_reject_impossible_values() -> None:
    with pytest.raises(ValidationError):
        Thresholds(min_sun_fraction=1.5)
    with pytest.raises(ValidationError):
        Thresholds(max_sun_dark_hours=-1.0)
    assert Thresholds(min_sun_fraction=0.0, min_earth_fraction=1.0).min_earth_fraction == 1.0


def test_weights_must_be_non_negative_and_not_all_zero() -> None:
    with pytest.raises(ValidationError):
        Weights(sun=-0.1, earth=1.0)
    with pytest.raises(ValidationError):
        Weights(sun=0.0, earth=0.0)
    assert Weights(sun=1.0, earth=0.0).earth == 0.0


def test_window_must_be_ordered_timezone_aware_and_inside_the_ephemeris() -> None:
    utc = UTC
    with pytest.raises(ValidationError):
        AnalysisWindow(start=datetime(2028, 1, 1, tzinfo=utc), end=datetime(2027, 1, 1, tzinfo=utc))
    with pytest.raises(ValidationError):
        AnalysisWindow(start=datetime(2027, 1, 1), end=datetime(2028, 1, 1, tzinfo=utc))
    with pytest.raises(ValidationError, match="ephemeris"):
        AnalysisWindow(start=datetime(1800, 1, 1, tzinfo=utc), end=datetime(1801, 1, 1, tzinfo=utc))
    # DE440s는 1849~2150을 덮으므로 100년 창도 허용
    century = AnalysisWindow(
        start=datetime(2027, 1, 1, tzinfo=utc),
        end=datetime(2127, 1, 1, tzinfo=utc),
        step_minutes=30,
    )
    assert century.sample_count() == pytest.approx(100 * 365.25 * 48, rel=1e-3)


def test_config_round_trips_through_json() -> None:
    config = SearchConfig(top_k=7, thresholds=Thresholds(min_sun_fraction=0.3))

    assert SearchConfig.model_validate_json(config.model_dump_json()) == config


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        SearchConfig.model_validate({"grid_spacing": 500})
