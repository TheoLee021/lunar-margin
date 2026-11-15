"""Batch the existing search without changing any date's adaptive sample population."""

import os
from collections.abc import Callable
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.candidates.calendar_field import compute_calendar_fields
from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.engine.candidates.field import FieldSettings, MetricField, open_dem
from lunar_margin.engine.candidates.filtering import evaluate
from lunar_margin.engine.candidates.grid import SitePoints, polar_grid, refine_points
from lunar_margin.engine.candidates.horizon_table import find_table
from lunar_margin.engine.candidates.projection import polar_xy_to_lonlat
from lunar_margin.engine.candidates.ranking import score_sites
from lunar_margin.engine.ephemeris import load_kernels
from lunar_margin.pipeline.candidates import (
    ProgressFn,
    SearchOutcome,
    field_settings,
    promotion_mask,
    run_search,
)
from lunar_margin.pipeline.horizons import TABLES_DIR, resolve_dems, table_spec_for


def run_search_batch(
    configs: list[SearchConfig],
    data_dir: Path,
    *,
    log: Callable[[str], None] = print,
    progress: ProgressFn | None = None,
    extra_warnings: list[list[str]] | None = None,
) -> list[SearchOutcome]:
    if not 1 <= len(configs) <= 5:
        raise ValueError("batch requires 1..5 search configurations")
    base = configs[0]
    shared = base.model_dump(exclude={"window", "thresholds", "weights"})
    if any(c.model_dump(exclude={"window", "thresholds", "weights"}) != shared for c in configs):
        raise ValueError("batch requires matching terrain and grid configuration")
    table = find_table(data_dir / TABLES_DIR, table_spec_for(base, data_dir))
    if table is None:
        log("전체 수평선 테이블 없음: 날짜별로 탐색하며 지점별 수평선 캐시를 공유합니다.")
        return [
            run_search(
                config,
                data_dir,
                log=log,
                progress=progress,
                extra_warnings=None if extra_warnings is None else extra_warnings[i],
            )
            for i, config in enumerate(configs)
        ]
    pairs = resolve_dems(base, data_dir).pairs
    dem = open_dem(pairs)
    load_kernels(data_dir / "spice")
    workers = base.workers or os.cpu_count() or 1

    def reporter(stage: str) -> Callable[[int, int], None] | None:
        callback = progress
        return None if callback is None else lambda done, total: callback(stage, done, total)

    coarse = None
    coarse_fields: list[MetricField] = []
    fine_sites: list[SitePoints] = []
    if base.coarse_spacing_m is not None and base.coarse_spacing_m != base.grid_spacing_m:
        coarse = polar_grid(base.roi, base.coarse_spacing_m)
        coarse_fields = compute_calendar_fields(
            dem,
            coarse,
            [field_settings(c, c.coarse_azimuth_step_deg) for c in configs],
            masks=[np.ones(len(coarse), dtype=np.bool_) for _ in configs],
            table=table,
            workers=workers,
            dem_files=pairs,
            on_progress=reporter("coarse"),
        )
        for config, field in zip(configs, coarse_fields, strict=True):
            filtered = evaluate(
                field,
                config.thresholds,
                exclude_incomplete_horizon=config.exclude_incomplete_horizon,
            )
            scores = score_sites(
                field,
                config.weights,
                rf=config.rf is not None,
                duration_hours=(config.window.end - config.window.start).total_seconds() / 3600,
            )
            promoted = promotion_mask(
                field, filtered, scores, config.thresholds, config.refine_fraction
            )
            fine_sites.append(refine_points(coarse, promoted, config.roi, config.grid_spacing_m))
    else:
        fine_sites = [polar_grid(c.roi, c.grid_spacing_m) for c in configs]

    coords, inverse = np.unique(
        np.concatenate([np.column_stack((p.iy, p.ix)) for p in fine_sites]),
        axis=0,
        return_inverse=True,
    )
    iy, ix = coords[:, 0], coords[:, 1]
    x, y = (
        (ix * base.grid_spacing_m).astype(np.float64),
        (iy * base.grid_spacing_m).astype(np.float64),
    )
    lat, lon = polar_xy_to_lonlat(x, y)
    union = SitePoints(ix, iy, x, y, lat, lon, base.grid_spacing_m, fine_sites[0].plan_id)
    positions = np.split(inverse, np.cumsum([len(p) for p in fine_sites])[:-1])
    masks: list[NDArray[np.bool_]] = []
    for indices in positions:
        mask = np.zeros(len(union), dtype=np.bool_)
        mask[indices] = True
        masks.append(mask)
    fine_fields = compute_calendar_fields(
        dem,
        union,
        [field_settings(c, c.fine_azimuth_step_deg) for c in configs],
        masks=masks,
        table=table,
        workers=workers,
        dem_files=pairs,
        on_progress=reporter("fine"),
    )
    outcomes: list[SearchOutcome] = []
    for i, config in enumerate(configs):

        def provide(sites: SitePoints, settings: FieldSettings, index: int = i) -> MetricField:
            if settings.window != configs[index].window:
                raise ValueError("precomputed field window mismatch")
            is_coarse = coarse is not None and sites.spacing_m == coarse.spacing_m
            expected = coarse if is_coarse else fine_sites[index]
            if (
                expected is None
                or not np.array_equal(sites.ix, expected.ix)
                or not np.array_equal(sites.iy, expected.iy)
            ):
                raise ValueError("precomputed field grid mismatch")
            return (
                coarse_fields[index] if is_coarse else fine_fields[index].subset(positions[index])
            )

        outcomes.append(
            run_search(
                config,
                data_dir,
                log=log,
                field_provider=provide,
                extra_warnings=None if extra_warnings is None else extra_warnings[i],
            )
        )
    return outcomes
