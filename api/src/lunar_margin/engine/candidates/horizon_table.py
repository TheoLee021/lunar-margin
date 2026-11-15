"""사전 계산한 수평선 테이블. 격자 지점마다 방위각별 지형 수평선을 한 번만 계산해 둔다.

수평선은 지점과 DEM, 탐색 거리, 관측 높이만으로 정해지고 날짜·제약과 무관하다. 임무 입력으로
탐색할 때 시간 계산은 거의 공짜이므로(지점당 0.2 ms), 수평선(지점당 약 55 ms)을 매번 다시
계산하는 것이 총 시간의 대부분이다. 그래서 한 번 계산해 파일로 두고 이후 탐색은 읽기만 한다.

고각은 0.01° 단위의 int16으로 저장한다 (오차 0.005° 이내, 극지 태양 고도 최대 약 1.5°에 비해 작다).
meta.json이 마지막에 쓰이므로 만들던 중인 테이블은 열리지 않는다.
"""

import hashlib
import json
from collections.abc import Callable, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Self

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.candidates.config import Roi
from lunar_margin.engine.candidates.grid import SitePoints, polar_grid
from lunar_margin.engine.dem import Dem
from lunar_margin.engine.horizon import HorizonProfile, horizon_profile

FORMAT_VERSION = 1
_OFFSET = 1 << 22
_STRIDE = 1 << 24
_SCALE = 100.0  # 0.01° 단위


def _keys(ix: NDArray[np.int64], iy: NDArray[np.int64]) -> NDArray[np.int64]:
    return (iy + _OFFSET) * _STRIDE + (ix + _OFFSET)


@dataclass(frozen=True)
class HorizonTableSpec:
    dem_id: str  # 주 DEM + 보충 DEM 파일을 가리키는 문자열. DEM이 바뀌면 다른 테이블이다
    roi: Roi
    spacing_m: float
    azimuth_step_deg: float
    max_range_m: float
    observer_height_m: float

    def table_id(self) -> str:
        canonical = json.dumps(
            {**asdict(self), "roi": self.roi.model_dump(), "v": FORMAT_VERSION}, sort_keys=True
        )
        return hashlib.sha256(canonical.encode()).hexdigest()[:12]

    def covers(self, needed: HorizonTableSpec) -> bool:
        """같은 조건이고 이 테이블의 ROI가 필요한 ROI를 덮으면 True."""
        return (
            self.dem_id == needed.dem_id
            and self.spacing_m == needed.spacing_m
            and self.azimuth_step_deg == needed.azimuth_step_deg
            and self.max_range_m == needed.max_range_m
            and self.observer_height_m == needed.observer_height_m
            and self.roi.min_lat_deg <= needed.roi.min_lat_deg
            and self.roi.max_lat_deg >= needed.roi.max_lat_deg
        )


class HorizonTable:
    def __init__(
        self,
        directory: Path,
        spec: HorizonTableSpec,
        keys: NDArray[np.int64],
        valid: NDArray[np.bool_],
        complete: NDArray[np.bool_],
        elevation: NDArray[np.int16],
    ) -> None:
        self.directory = directory
        self.spec = spec
        self._keys = keys
        self._valid = valid
        self._complete = complete
        self._elevation = elevation
        self.azimuth_deg = np.arange(0.0, 360.0, spec.azimuth_step_deg)

    @classmethod
    def open(cls, directory: Path) -> Self:
        meta_path = directory / "meta.json"
        if not meta_path.exists():
            raise FileNotFoundError(f"horizon table is missing or unfinished: {directory}")
        meta = json.loads(meta_path.read_text())
        if meta.get("version") != FORMAT_VERSION:
            raise FileNotFoundError(f"unsupported horizon table version in {directory}")
        spec = HorizonTableSpec(
            dem_id=meta["dem_id"],
            roi=Roi(**meta["roi"]),
            spacing_m=meta["spacing_m"],
            azimuth_step_deg=meta["azimuth_step_deg"],
            max_range_m=meta["max_range_m"],
            observer_height_m=meta["observer_height_m"],
        )
        return cls(
            directory,
            spec,
            np.load(directory / "keys.npy"),
            np.load(directory / "valid.npy"),
            np.load(directory / "complete.npy"),
            np.load(directory / "elevation.npy", mmap_mode="r"),
        )

    def __len__(self) -> int:
        return int(self._keys.shape[0])

    def rows_for(self, sites: SitePoints) -> NDArray[np.int64]:
        """각 지점의 테이블 행 번호. 테이블에 없거나 격자가 맞지 않으면 -1."""
        missing = np.full(len(sites), -1, dtype=np.int64)
        ratio = sites.spacing_m / self.spec.spacing_m
        if ratio < 1.0 or abs(ratio - round(ratio)) > 1e-9:
            return missing
        m = round(ratio)
        fx, fy = sites.ix * m, sites.iy * m
        inside = (np.abs(fx) < _OFFSET) & (np.abs(fy) < _OFFSET)
        keys = np.where(inside, _keys(fx, fy), -1)
        position = np.minimum(np.searchsorted(self._keys, keys), len(self) - 1)
        found = inside & (self._keys[position] == keys) & self._valid[position]
        return np.where(found, position, -1).astype(np.int64)

    def profile(self, row: int) -> HorizonProfile:
        return HorizonProfile(
            azimuth_deg=self.azimuth_deg,
            elevation_deg=np.asarray(self._elevation[row], dtype=np.float64) / _SCALE,
            complete=bool(self._complete[row]),
        )


def find_table(root: Path, needed: HorizonTableSpec) -> HorizonTable | None:
    """root 아래에서 필요한 조건을 덮는 완성된 테이블을 찾는다."""
    if not root.is_dir():
        return None
    for directory in sorted(root.iterdir()):
        try:
            table = HorizonTable.open(directory)
        except FileNotFoundError, OSError, ValueError, KeyError:
            continue
        if table.spec.covers(needed):
            return table
    return None


_worker_dem: Dem | None = None


def _init_worker(pairs: tuple[tuple[str, str], ...]) -> None:
    from lunar_margin.engine.candidates.field import open_dem

    global _worker_dem
    _worker_dem = open_dem(pairs)


def _compute_chunk(
    dem: Dem, spec: HorizonTableSpec, lat: NDArray[np.float64], lon: NDArray[np.float64]
) -> tuple[NDArray[np.int16], NDArray[np.bool_], NDArray[np.bool_]]:
    n_az = int(np.arange(0.0, 360.0, spec.azimuth_step_deg).shape[0])
    elevation = np.zeros((lat.shape[0], n_az), dtype=np.int16)
    complete = np.zeros(lat.shape[0], dtype=np.bool_)
    valid = np.zeros(lat.shape[0], dtype=np.bool_)
    for k in range(lat.shape[0]):
        try:
            profile = horizon_profile(
                dem,
                float(lat[k]),
                float(lon[k]),
                observer_height_m=spec.observer_height_m,
                azimuth_step_deg=spec.azimuth_step_deg,
                max_range_m=spec.max_range_m,
            )
        except ValueError:  # DEM 밖: 비워 둔다
            continue
        elevation[k] = np.clip(np.round(profile.elevation_deg * _SCALE), -32767, 32767)
        complete[k] = profile.complete
        valid[k] = True
    return elevation, valid, complete


def _worker_chunk(
    args: tuple[HorizonTableSpec, NDArray[np.float64], NDArray[np.float64]],
) -> tuple[NDArray[np.int16], NDArray[np.bool_], NDArray[np.bool_]]:
    if _worker_dem is None:
        raise RuntimeError("worker was not initialised")
    return _compute_chunk(_worker_dem, args[0], args[1], args[2])


def build_horizon_table(
    directory: Path,
    spec: HorizonTableSpec,
    dem: Dem,
    *,
    workers: int = 1,
    dem_pairs: Sequence[tuple[Path, Path]] | None = None,
    chunk_size: int = 256,
    on_progress: Callable[[int, int], None] | None = None,
) -> None:
    """spec의 모든 격자 지점의 수평선을 계산해 directory에 쓴다. meta.json이 마지막에 쓰인다."""
    if workers > 1 and dem_pairs is None:
        raise ValueError("dem_pairs is required when workers > 1")
    directory.mkdir(parents=True, exist_ok=True)
    sites = polar_grid(spec.roi, spec.spacing_m)
    n = len(sites)
    n_az = int(np.arange(0.0, 360.0, spec.azimuth_step_deg).shape[0])
    elevation = np.lib.format.open_memmap(
        directory / "elevation.npy", mode="w+", dtype=np.int16, shape=(n, n_az)
    )
    valid = np.zeros(n, dtype=np.bool_)
    complete = np.zeros(n, dtype=np.bool_)
    slices = [slice(a, min(a + chunk_size, n)) for a in range(0, n, chunk_size)]

    def store(
        sl: slice,
        result: tuple[NDArray[np.int16], NDArray[np.bool_], NDArray[np.bool_]],
    ) -> None:
        elevation[sl], valid[sl], complete[sl] = result
        if on_progress is not None:
            on_progress(sl.stop, n)

    if workers <= 1:
        for sl in slices:
            store(sl, _compute_chunk(dem, spec, sites.lat_deg[sl], sites.lon_deg[sl]))
    else:
        assert dem_pairs is not None
        pairs = tuple((str(a), str(b)) for a, b in dem_pairs)
        jobs = [(spec, sites.lat_deg[sl], sites.lon_deg[sl]) for sl in slices]
        with ProcessPoolExecutor(
            max_workers=workers, initializer=_init_worker, initargs=(pairs,)
        ) as pool:
            for sl, result in zip(slices, pool.map(_worker_chunk, jobs), strict=True):
                store(sl, result)

    elevation.flush()
    np.save(directory / "keys.npy", _keys(sites.ix, sites.iy))
    np.save(directory / "valid.npy", valid)
    np.save(directory / "complete.npy", complete)
    meta = {
        "version": FORMAT_VERSION,
        "dem_id": spec.dem_id,
        "roi": spec.roi.model_dump(),
        "spacing_m": spec.spacing_m,
        "azimuth_step_deg": spec.azimuth_step_deg,
        "max_range_m": spec.max_range_m,
        "observer_height_m": spec.observer_height_m,
        "sites": n,
    }
    (directory / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
