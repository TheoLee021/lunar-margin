"""지점별 일조·지구 가시성 지표 장(field). 값이 NaN이면 '계산되지 않음(결측)'이다."""

import math
from collections.abc import Callable, Iterator, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, fields
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.candidates.config import AnalysisWindow
from lunar_margin.engine.candidates.grid import SitePoints
from lunar_margin.engine.candidates.horizon_table import HorizonTable
from lunar_margin.engine.dem import CompositeDem, Dem, PolarDem
from lunar_margin.engine.ephemeris import body_vectors, topocentric_azel, utc_range
from lunar_margin.engine.horizon import HorizonProfile, horizon_profile
from lunar_margin.engine.metrics import summarize, visibility_series
from lunar_margin.engine.site_characteristics import characterize_region


@dataclass(frozen=True)
class MetricField:
    sun_fraction: NDArray[np.float64]
    sun_longest_dark_h: NDArray[np.float64]
    sun_windows_per_24h: NDArray[np.float64]
    sun_mean_elevation_deg: NDArray[np.float64]
    earth_fraction: NDArray[np.float64]
    earth_longest_blackout_h: NDArray[np.float64]
    earth_windows_per_24h: NDArray[np.float64]
    earth_mean_elevation_deg: NDArray[np.float64]
    horizon_max_deg: NDArray[np.float64]
    horizon_complete: NDArray[np.bool_]
    computed: NDArray[np.bool_]  # False면 이 지점의 어떤 지표도 계산하지 못했다 (예: DEM 밖)

    terrain_slope_p95_deg: NDArray[np.float64]
    terrain_coverage_fraction: NDArray[np.float64]

    def __len__(self) -> int:
        return int(self.computed.shape[0])

    @classmethod
    def missing(cls, n: int) -> MetricField:
        """n개 지점 모두 결측인 장. 테스트와 부분 채우기용."""
        nan = np.full(n, np.nan)
        return cls(
            sun_fraction=nan.copy(),
            sun_longest_dark_h=nan.copy(),
            sun_windows_per_24h=nan.copy(),
            sun_mean_elevation_deg=nan.copy(),
            earth_fraction=nan.copy(),
            earth_longest_blackout_h=nan.copy(),
            earth_windows_per_24h=nan.copy(),
            earth_mean_elevation_deg=nan.copy(),
            horizon_max_deg=nan.copy(),
            horizon_complete=np.zeros(n, dtype=np.bool_),
            computed=np.zeros(n, dtype=np.bool_),
            terrain_slope_p95_deg=nan.copy(),
            terrain_coverage_fraction=nan.copy(),
        )

    @classmethod
    def concat(cls, parts: list[MetricField]) -> MetricField:
        return cls(
            **{f.name: np.concatenate([getattr(p, f.name) for p in parts]) for f in fields(cls)}
        )

    def subset(self, selector: NDArray[np.bool_] | NDArray[np.int64]) -> MetricField:
        return MetricField(**{f.name: getattr(self, f.name)[selector] for f in fields(self)})


@dataclass(frozen=True)
class FieldSettings:
    window: AnalysisWindow
    azimuth_step_deg: float
    max_range_m: float
    observer_height_m: float
    assess_terrain: bool = False


@dataclass(frozen=True)
class FieldContext:
    dem: Dem
    table: HorizonTable | None
    sun_vectors: NDArray[np.float64]
    earth_vectors: NDArray[np.float64]
    settings: FieldSettings


# 한 지점이 돌려주는 값의 열 순서 (MetricField의 필드 순서와 같다)
_COLUMNS = 13
MISSING_ROW = (math.nan,) * 9 + (0.0, 0.0) + (math.nan, math.nan)


def _site_row(ctx: FieldContext, lat_deg: float, lon_deg: float, row: int) -> tuple[float, ...]:
    s = ctx.settings
    if ctx.table is not None and row >= 0:
        horizon = ctx.table.profile(row)  # 사전 계산한 수평선: 다시 계산하지 않는다
    else:
        try:
            horizon = horizon_profile(
                ctx.dem,
                lat_deg,
                lon_deg,
                observer_height_m=s.observer_height_m,
                azimuth_step_deg=s.azimuth_step_deg,
                max_range_m=s.max_range_m,
            )
        except ValueError:  # DEM 밖이거나 유효한 표본이 없는 지점: 결측으로 남긴다
            return MISSING_ROW
    return _profile_row(ctx, lat_deg, lon_deg, horizon)


def _profile_row(
    ctx: FieldContext, lat_deg: float, lon_deg: float, horizon: HorizonProfile
) -> tuple[float, ...]:
    s = ctx.settings
    values: list[float] = []
    for vectors in (ctx.sun_vectors, ctx.earth_vectors):
        azimuth, elevation = topocentric_azel(vectors, lat_deg, lon_deg, s.observer_height_m)
        visible = visibility_series(horizon, azimuth, elevation)
        metrics = summarize(visible, s.window.step_minutes, elevation)
        mean_el = math.nan if metrics.mean_elevation_deg is None else metrics.mean_elevation_deg
        values += [
            metrics.visible_fraction,
            metrics.longest_dark_hours,
            metrics.windows_per_24h,
            mean_el,
        ]
    values += [float(horizon.elevation_deg.max()), float(horizon.complete), 1.0]
    values += (
        terrain_metrics(ctx.dem, lat_deg, lon_deg) if s.assess_terrain else (math.nan, math.nan)
    )
    return tuple(values)


def terrain_metrics(dem: Dem, lat_deg: float, lon_deg: float) -> tuple[float, float]:
    """Regional ground terrain, independent of the analysis date or observer height."""
    # The wider fallback DEM is for horizon rays, not regional landing terrain.
    terrain_dem = dem.primary if isinstance(dem, CompositeDem) else dem
    try:
        region = characterize_region(terrain_dem, lat_deg, lon_deg)
    except ValueError:
        return math.nan, 0.0
    slope = region.slope_p95_deg if region.slope_p95_deg is not None else math.nan
    return slope, region.coverage_fraction


def _chunk_rows(
    ctx: FieldContext,
    lat: NDArray[np.float64],
    lon: NDArray[np.float64],
    table_rows: NDArray[np.int64],
) -> NDArray[np.float64]:
    rows = [
        _site_row(ctx, float(a), float(b), int(r))
        for a, b, r in zip(lat, lon, table_rows, strict=True)
    ]
    return np.array(rows, dtype=np.float64).reshape(len(rows), _COLUMNS)


_worker_ctx: FieldContext | None = None


def _init_worker(
    dem_pairs: tuple[tuple[str, str], ...],
    sun_vectors: NDArray[np.float64],
    earth_vectors: NDArray[np.float64],
    settings: FieldSettings,
    table_dir: str | None,
) -> None:
    global _worker_ctx
    table = HorizonTable.open(Path(table_dir)) if table_dir is not None else None
    _worker_ctx = FieldContext(open_dem(dem_pairs), table, sun_vectors, earth_vectors, settings)


def open_dem(pairs: Sequence[tuple[str | Path, str | Path]]) -> Dem:
    """(이미지, 라벨) 파일 쌍으로 DEM을 연다. 쌍이 둘이면 첫째가 주(고해상도), 둘째가 보충이다."""
    dems = [PolarDem.from_files(Path(img), Path(lbl)) for img, lbl in pairs]
    if len(dems) == 1:
        return dems[0]
    if len(dems) == 2:
        return CompositeDem(dems[0], dems[1])
    raise ValueError("expected one or two DEM file pairs")


def _worker_chunk(
    args: tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.int64]],
) -> NDArray[np.float64]:
    if _worker_ctx is None:
        raise RuntimeError("worker was not initialised")
    return _chunk_rows(_worker_ctx, args[0], args[1], args[2])


def _chunks(n: int, size: int) -> Iterator[slice]:
    for start in range(0, n, size):
        yield slice(start, min(start + size, n))


def compute_field(
    dem: Dem,
    sites: SitePoints,
    settings: FieldSettings,
    *,
    workers: int = 1,
    dem_files: Sequence[tuple[Path, Path]] | None = None,
    chunk_size: int = 64,
    on_progress: Callable[[int, int], None] | None = None,
    table: HorizonTable | None = None,
) -> MetricField:
    """각 지점의 일조·지구 가시성 지표를 계산한다.

    지점과 무관한 태양·지구 위치 벡터는 한 번만 구해 모든 지점이 공유한다. SPICE 커널은
    호출하기 전에 로드해 둬야 한다. workers > 1이면 프로세스를 나눠 계산하는데, 각 프로세스가
    DEM을 직접 열 수 있도록 dem_files가 필요하다. 결과는 workers 수와 무관하게 항상 같다.
    """
    if workers > 1 and dem_files is None:
        raise ValueError("dem_files is required when workers > 1")
    et = utc_range(settings.window.start, settings.window.end, settings.window.step_minutes)
    sun = body_vectors("SUN", et)
    earth = body_vectors("EARTH", et)

    n = len(sites)
    matrix = np.full((n, _COLUMNS), np.nan)
    slices = list(_chunks(n, chunk_size))
    table_rows = table.rows_for(sites) if table is not None else np.full(n, -1, dtype=np.int64)
    if workers <= 1 or n <= chunk_size:
        ctx = FieldContext(dem, table, sun, earth, settings)
        for sl in slices:
            matrix[sl] = _chunk_rows(ctx, sites.lat_deg[sl], sites.lon_deg[sl], table_rows[sl])
            if on_progress is not None:
                on_progress(sl.stop, n)
    else:
        assert dem_files is not None
        jobs = [(sites.lat_deg[sl], sites.lon_deg[sl], table_rows[sl]) for sl in slices]
        pairs = tuple((str(img), str(lbl)) for img, lbl in dem_files)
        table_dir = str(table.directory) if table is not None else None
        init_args = (pairs, sun, earth, settings, table_dir)
        with ProcessPoolExecutor(
            max_workers=workers, initializer=_init_worker, initargs=init_args
        ) as pool:
            for sl, rows in zip(slices, pool.map(_worker_chunk, jobs), strict=True):
                matrix[sl] = rows
                if on_progress is not None:
                    on_progress(sl.stop, n)

    return field_from_matrix(matrix)


def field_from_matrix(matrix: NDArray[np.float64]) -> MetricField:
    return MetricField(
        sun_fraction=matrix[:, 0],
        sun_longest_dark_h=matrix[:, 1],
        sun_windows_per_24h=matrix[:, 2],
        sun_mean_elevation_deg=matrix[:, 3],
        earth_fraction=matrix[:, 4],
        earth_longest_blackout_h=matrix[:, 5],
        earth_windows_per_24h=matrix[:, 6],
        earth_mean_elevation_deg=matrix[:, 7],
        horizon_max_deg=matrix[:, 8],
        horizon_complete=matrix[:, 9] > 0.5,
        computed=matrix[:, 10] > 0.5,
        terrain_slope_p95_deg=matrix[:, 11],
        terrain_coverage_fraction=matrix[:, 12],
    )
