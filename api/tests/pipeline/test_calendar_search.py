from dataclasses import fields
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from lunar_margin.engine.candidates.config import Roi, SearchConfig
from lunar_margin.engine.candidates.field import MetricField
from lunar_margin.engine.candidates.mission import MissionRequest, plan_search
from lunar_margin.pipeline.calendar_search import run_search_batch
from lunar_margin.pipeline.candidates import run_search
from lunar_margin.pipeline.horizons import build_for_config


def test_batch_keeps_each_dates_exact_adaptive_grids_and_results(
    data_dir: Path, tmp_path: Path
) -> None:
    for folder in ("dem", "spice"):
        (tmp_path / folder).symlink_to((data_dir / folder).resolve(), target_is_directory=True)
    base = SearchConfig(roi=Roi(max_lat_deg=-89.95), coarse_spacing_m=1000, workers=1)
    configs = [
        plan_search(
            MissionRequest(
                landing_date=date(2027, 1, 8) + timedelta(days=d),
                mission_duration_days=14,
                max_continuous_darkness_hours=216,
                max_communication_blackout_hours=216,
                optimization_priority=("solar" if d % 2 else "earth"),
            ),
            base,
        ).config
        for d in range(5)
    ]
    build_for_config(base, tmp_path, workers=1, log=lambda _: None)
    expected = [run_search(config, tmp_path, log=lambda _: None) for config in configs]
    actual = run_search_batch(configs, tmp_path, log=lambda _: None)
    for before, after in zip(expected, actual, strict=True):
        for name in ("ix", "iy", "spacing_m", "stage", "region_id", "rank", "picked_as", "note"):
            np.testing.assert_array_equal(getattr(after, name), getattr(before, name))
        for name in ("status", "failed", "skipped"):
            np.testing.assert_array_equal(
                getattr(after.filtered, name), getattr(before.filtered, name)
            )
        for field in fields(MetricField):
            np.testing.assert_array_equal(
                getattr(after.field, field.name), getattr(before.field, field.name)
            )
        np.testing.assert_array_equal(after.scores.total, before.scores.total)
        assert after.summary == before.summary


def test_dates_without_a_full_table_share_incremental_3m_horizons(
    data_dir: Path, tmp_path: Path
) -> None:
    from datetime import UTC, datetime

    from lunar_margin.engine.candidates.config import AnalysisWindow

    for folder in ("dem", "spice"):
        (tmp_path / folder).symlink_to((data_dir / folder).resolve(), target_is_directory=True)
    base = SearchConfig(
        roi=Roi(max_lat_deg=-89.95),
        coarse_spacing_m=None,
        observer_height_m=3,
        max_range_m=2000,
        workers=1,
    )
    configs = [
        base.model_copy(
            update={
                "window": AnalysisWindow(
                    start=datetime(2027, 1, 1 + d, tzinfo=UTC),
                    end=datetime(2027, 1, 2 + d, tzinfo=UTC),
                    step_minutes=120,
                )
            }
        )
        for d in range(2)
    ]
    logs: list[str] = []
    actual = run_search_batch(configs, tmp_path, log=logs.append)
    count = actual[0].summary.counts["computed"]
    assert f"수평선 캐시: 재사용 0, 새로 저장 {count}" in logs
    assert f"수평선 캐시: 재사용 {count}, 새로 저장 0" in logs
    for config, result in zip(configs, actual, strict=True):
        expected = run_search(config, tmp_path, log=lambda _: None)
        np.testing.assert_array_equal(result.field.sun_fraction, expected.field.sun_fraction)
        np.testing.assert_array_equal(result.field.earth_fraction, expected.field.earth_fraction)
        np.testing.assert_array_equal(result.rank, expected.rank)
