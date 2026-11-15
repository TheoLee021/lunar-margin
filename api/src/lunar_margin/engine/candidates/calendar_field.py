"""Evaluate exact per-date windows using one worker pool and one horizon read per site."""

import math
from collections.abc import Callable, Sequence
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.candidates.field import (
    MISSING_ROW,
    FieldContext,
    FieldSettings,
    MetricField,
    field_from_matrix,
    open_dem,
    terrain_metrics,
)
from lunar_margin.engine.candidates.grid import SitePoints
from lunar_margin.engine.candidates.horizon_table import HorizonTable
from lunar_margin.engine.dem import Dem
from lunar_margin.engine.ephemeris import body_vectors, topocentric_azel, utc_range
from lunar_margin.engine.metrics import visibility_series

_contexts: list[FieldContext] = []
_table: HorizonTable | None = None
Job = tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.int64], NDArray[np.bool_]]


def _init(
    pairs: tuple[tuple[str, str], ...],
    table_dir: str,
    vectors: list[tuple[NDArray[np.float64], NDArray[np.float64]]],
    settings: list[FieldSettings],
) -> None:
    global _contexts, _table
    _table = HorizonTable.open(Path(table_dir))
    dem = open_dem(pairs)
    _contexts = [
        FieldContext(dem, _table, sun, earth, window)
        for (sun, earth), window in zip(vectors, settings, strict=True)
    ]


def _rows(contexts: list[FieldContext], table: HorizonTable, job: Job) -> NDArray[np.float64]:
    lat, lon, rows, masks = job
    out = np.tile(np.array(MISSING_ROW), (len(contexts), len(lat), 1))
    cuts = np.concatenate(([0], np.cumsum([len(ctx.sun_vectors) for ctx in contexts])))
    sun = np.concatenate([ctx.sun_vectors for ctx in contexts])
    earth = np.concatenate([ctx.earth_vectors for ctx in contexts])
    profiles = [table.profile(int(row)) for row in rows]
    quality = np.array([(float(p.elevation_deg.max()), float(p.complete), 1.0) for p in profiles])
    out[:, :, 8:11] = quality
    if any(ctx.settings.assess_terrain for ctx in contexts):
        terrain = np.array(
            [
                terrain_metrics(contexts[0].dem, float(a), float(b))
                for a, b in zip(lat, lon, strict=True)
            ]
        )
        for i, ctx in enumerate(contexts):
            if ctx.settings.assess_terrain:
                out[i, :, 11:13] = terrain
    for body, vectors in enumerate((sun, earth)):
        elevations: list[NDArray[np.float64]] = []
        visibility: list[NDArray[np.bool_]] = []
        for a, b, profile in zip(lat, lon, profiles, strict=True):
            az, el = topocentric_azel(
                vectors, float(a), float(b), contexts[0].settings.observer_height_m
            )
            elevations.append(el)
            visibility.append(visibility_series(profile, az, el))
        all_el = np.array(elevations)
        all_vis = np.array(visibility)
        for i, ctx in enumerate(contexts):
            sl = slice(int(cuts[i]), int(cuts[i + 1]))
            vis, el = all_vis[:, sl], all_el[:, sl]
            step_hours = ctx.settings.window.step_minutes / 60.0
            duration_days = vis.shape[1] * step_hours / 24.0
            ticks = np.arange(1, vis.shape[1] + 1, dtype=np.int64)
            last_on = np.maximum.accumulate(np.where(vis, ticks, 0), axis=1)
            longest = (ticks - last_on).max(axis=1) * step_hours
            windows = vis[:, 0].astype(np.int64) + np.count_nonzero(
                vis[:, 1:] & ~vis[:, :-1], axis=1
            )
            # Retain the original compressed-array summation order for exact means.
            means = np.array(
                [float(e[v].mean()) if v.any() else math.nan for e, v in zip(el, vis, strict=True)]
            )
            out[i, :, body * 4 : body * 4 + 4] = np.column_stack(
                (vis.mean(axis=1), longest, windows / duration_days, means)
            )
    for i, mask in enumerate(masks):
        out[i, ~mask] = MISSING_ROW
    return out


def _work(job: Job) -> NDArray[np.float64]:
    if _table is None:
        raise RuntimeError("calendar worker was not initialized")
    return _rows(_contexts, _table, job)


def compute_calendar_fields(
    dem: Dem,
    sites: SitePoints,
    settings: list[FieldSettings],
    *,
    masks: list[NDArray[np.bool_]],
    table: HorizonTable,
    workers: int = 1,
    dem_files: Sequence[tuple[Path, Path]] | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> list[MetricField]:
    if not settings or len(settings) != len(masks):
        raise ValueError("one site mask is required for each window")
    if any(mask.shape != (len(sites),) for mask in masks):
        raise ValueError("site mask shape mismatch")
    if any(window.observer_height_m != settings[0].observer_height_m for window in settings):
        raise ValueError("calendar windows must use the same observer height")
    rows = table.rows_for(sites)
    if (rows < 0).any():
        raise ValueError("complete horizon table coverage is required for batch calculation")
    # Keep each original ET range exactly. UTC windows converted independently can have
    # slightly different TDB offsets; approximating them by slicing a union changes inputs.
    vectors = [
        (body_vectors("SUN", et), body_vectors("EARTH", et))
        for window in settings
        for et in [utc_range(window.window.start, window.window.end, window.window.step_minutes)]
    ]
    matrix = np.tile(np.array(MISSING_ROW), (len(settings), len(sites), 1))
    chunk = min(128, max(1, 1_000_000 // sum(len(sun) for sun, _ in vectors)))
    slices = [slice(start, min(start + chunk, len(sites))) for start in range(0, len(sites), chunk)]
    mask_matrix = np.array(masks)
    jobs = [(sites.lat_deg[sl], sites.lon_deg[sl], rows[sl], mask_matrix[:, sl]) for sl in slices]
    if workers <= 1 or len(sites) <= chunk:
        contexts = [
            FieldContext(dem, table, sun, earth, window)
            for (sun, earth), window in zip(vectors, settings, strict=True)
        ]
        results = (_rows(contexts, table, job) for job in jobs)
        for sl, result in zip(slices, results, strict=True):
            matrix[:, sl] = result
            if on_progress is not None:
                on_progress(sl.stop, len(sites))
    else:
        if dem_files is None:
            raise ValueError("dem_files required for parallel batch calculation")
        pairs = tuple((str(a), str(b)) for a, b in dem_files)
        with ProcessPoolExecutor(
            max_workers=workers,
            initializer=_init,
            initargs=(pairs, str(table.directory), vectors, settings),
        ) as pool:
            for sl, result in zip(slices, pool.map(_work, jobs), strict=True):
                matrix[:, sl] = result
                if on_progress is not None:
                    on_progress(sl.stop, len(sites))
    return [field_from_matrix(matrix[i]) for i in range(len(settings))]
