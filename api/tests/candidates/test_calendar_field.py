from dataclasses import fields
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np

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
