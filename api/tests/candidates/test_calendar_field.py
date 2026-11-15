from dataclasses import fields
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from lunar_margin.engine.candidates.calendar_field import compute_calendar_fields
from lunar_margin.engine.candidates.config import AnalysisWindow, Roi
from lunar_margin.engine.candidates.field import FieldSettings, MetricField, compute_field
from lunar_margin.engine.candidates.grid import polar_grid
from lunar_margin.engine.candidates.horizon_table import (
    HorizonTable,
    HorizonTableSpec,
    build_horizon_table,
)
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.ephemeris import load_kernels
from lunar_margin.pipeline.pds_label import PolarGridLabel


def test_five_windows_match_independent_fields_exactly_with_different_site_masks(
    data_dir: Path, tmp_path: Path
) -> None:
    load_kernels(data_dir / "spice")
    dem_files = [(data_dir / "dem/ldem_80s_80m_float.img", data_dir / "dem/ldem_80s_80m_float.lbl")]
    dem = PolarDem.from_files(*dem_files[0])
    roi = Roi(max_lat_deg=-89.98)
    sites = polar_grid(roi, 500)
    spec = HorizonTableSpec("test", roi, 500, 1, 2000, 0)
    build_horizon_table(tmp_path / "table", spec, dem)
    table = HorizonTable.open(tmp_path / "table")
    settings = [
        FieldSettings(
            AnalysisWindow(
                start=datetime(2027, 1, 1, tzinfo=UTC) + timedelta(days=d),
                end=datetime(2027, 1, 15, tzinfo=UTC) + timedelta(days=d),
                step_minutes=30,
            ),
            1,
            2000,
            0,
        )
        for d in range(5)
    ]
    masks = [np.arange(len(sites)) % 3 != d % 3 for d in range(5)]
    actual = compute_calendar_fields(
        dem, sites, settings, masks=masks, table=table, workers=2, dem_files=dem_files
    )
    for window, mask, batch in zip(settings, masks, actual, strict=True):
        expected = compute_field(dem, sites.subset(mask), window, table=table)
        for field in fields(MetricField):
            np.testing.assert_array_equal(
                getattr(batch, field.name)[mask], getattr(expected, field.name)
            )
        assert np.isnan(batch.sun_fraction[~mask]).all()
        assert not batch.computed[~mask].any()


def test_batch_preserves_enabled_and_disabled_regional_terrain_assessment(
    data_dir: Path, tmp_path: Path
) -> None:
    load_kernels(data_dir / "spice")
    # A known 20-degree plane, with enough DEM coverage for the full region.
    columns = np.arange(101, dtype=np.float64) - 50
    heights_km = np.tile(columns * 100 * np.tan(np.deg2rad(20)) / 1000, (101, 1))
    dem = PolarDem(
        heights_km.astype(np.float32),
        PolarGridLabel(101, 101, 100, 50, 50, 1737.4, 1737.4, -90),
    )
    roi = Roi(max_lat_deg=-89.98)
    sites = polar_grid(roi, 500)
    build_horizon_table(
        tmp_path / "terrain-table", HorizonTableSpec("plane", roi, 500, 90, 2000, 0), dem
    )
    table = HorizonTable.open(tmp_path / "terrain-table")
    window = AnalysisWindow(
        start=datetime(2027, 1, 1, tzinfo=UTC),
        end=datetime(2027, 1, 2, tzinfo=UTC),
        step_minutes=60,
    )
    settings = [
        FieldSettings(window, 90, 2000, 0, assess_terrain=enabled) for enabled in (True, False)
    ]
    masks = [np.ones(len(sites), dtype=np.bool_) for _ in settings]
    assessed, disabled = compute_calendar_fields(dem, sites, settings, masks=masks, table=table)
    assert assessed.terrain_slope_p95_deg == pytest.approx(20, abs=0.05)
    np.testing.assert_array_equal(assessed.terrain_coverage_fraction, 1)
    assert np.isnan(disabled.terrain_slope_p95_deg).all()
    assert np.isnan(disabled.terrain_coverage_fraction).all()
    independent = compute_field(dem, sites, settings[0], table=table)
    for metric in fields(MetricField):
        np.testing.assert_array_equal(
            getattr(assessed, metric.name), getattr(independent, metric.name)
        )
