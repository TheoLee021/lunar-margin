from pathlib import Path

import numpy as np
import pytest

from lunar_margin.engine.candidates.config import Roi
from lunar_margin.engine.candidates.grid import SitePoints, polar_grid
from lunar_margin.engine.candidates.horizon_table import (
    HorizonTable,
    HorizonTableSpec,
    build_horizon_table,
    find_table,
)
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.horizon import horizon_profile
from lunar_margin.pipeline.pds_label import PolarGridLabel

N, C = 401, 200


def synthetic_dem() -> PolarDem:
    label = PolarGridLabel(N, N, 100.0, float(C), float(C), 1737.4, 1737.4, -90.0)
    heights = np.zeros((N, N), dtype=np.float32)
    yy, xx = np.mgrid[0:N, 0:N]
    heights[(np.hypot(yy - C, xx - C) >= 90) & (np.hypot(yy - C, xx - C) <= 94)] = 0.4
    heights[(xx > 215) & (xx < 235) & (yy > 185) & (yy < 215)] = 0.7
    return PolarDem(heights, label)


def spec(**overrides: object) -> HorizonTableSpec:
    base: dict[str, object] = {
        "dem_id": "synthetic",
        "roi": Roi(min_lat_deg=-90.0, max_lat_deg=-89.9),  # 극에서 약 3 km
        "spacing_m": 500.0,
        "azimuth_step_deg": 10.0,
        "max_range_m": 15_000.0,
        "observer_height_m": 0.0,
    }
    return HorizonTableSpec(**{**base, **overrides})  # pyright: ignore[reportArgumentType]


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, HorizonTable]:
    directory = tmp_path_factory.mktemp("horizons") / spec().table_id()
    build_horizon_table(directory, spec(), synthetic_dem())
    return directory, HorizonTable.open(directory)


def test_the_table_id_depends_on_every_parameter() -> None:
    base = spec().table_id()

    assert base == spec().table_id()
    for change in (
        {"dem_id": "other"},
        {"spacing_m": 250.0},
        {"azimuth_step_deg": 5.0},
        {"max_range_m": 20_000.0},
        {"observer_height_m": 2.0},
        {"roi": Roi(min_lat_deg=-90.0, max_lat_deg=-89.8)},
    ):
        assert spec(**change).table_id() != base, change


def test_stored_profiles_match_direct_computation(built: tuple[Path, HorizonTable]) -> None:
    _, table = built
    dem = synthetic_dem()
    sites = polar_grid(spec().roi, 500.0)

    rows = table.rows_for(sites)

    assert np.all(rows >= 0) and len(set(rows.tolist())) == len(sites)
    for k in (0, len(sites) // 2, len(sites) - 1):
        direct = horizon_profile(
            dem, float(sites.lat_deg[k]), float(sites.lon_deg[k]), azimuth_step_deg=10.0,
            max_range_m=15_000.0,
        )  # fmt: skip
        stored = table.profile(int(rows[k]))
        assert np.allclose(
            stored.elevation_deg, direct.elevation_deg, atol=0.006
        )  # 0.01° 단위로 저장
        assert stored.complete == direct.complete
        assert np.array_equal(stored.azimuth_deg, direct.azimuth_deg)


def test_coarse_sites_are_found_through_the_whole_ratio(built: tuple[Path, HorizonTable]) -> None:
    _, table = built
    coarse = polar_grid(spec().roi, 1000.0)

    rows = table.rows_for(coarse)

    assert np.all(rows >= 0)
    fine = polar_grid(spec().roi, 500.0)
    expected = {(2 * int(i), 2 * int(j)) for i, j in zip(coarse.ix, coarse.iy, strict=True)}
    found = {(int(fine.ix[r]), int(fine.iy[r])) for r in rows.tolist()}
    assert found == expected


def test_sites_outside_the_table_or_off_its_lattice_are_reported_as_missing(
    built: tuple[Path, HorizonTable],
) -> None:
    _, table = built
    ix = np.array(
        [0, 40, 3], dtype=np.int64
    )  # (0,0) 있음 / (40,0)=20 km 밖 / 간격 750 m는 격자가 아님
    iy = np.zeros(3, dtype=np.int64)
    zeros = np.zeros(3)
    on_lattice = SitePoints(ix[:2], iy[:2], zeros[:2], zeros[:2], zeros[:2], zeros[:2], 500.0, "t")
    off_lattice = SitePoints(ix[2:], iy[2:], zeros[2:], zeros[2:], zeros[2:], zeros[2:], 750.0, "t")

    assert table.rows_for(on_lattice).tolist()[1] == -1 and table.rows_for(on_lattice)[0] >= 0
    assert table.rows_for(off_lattice).tolist() == [-1]


def test_an_unfinished_build_is_invisible(tmp_path: Path) -> None:
    directory = tmp_path / "half"
    directory.mkdir()
    np.save(directory / "keys.npy", np.arange(3))  # meta.json이 없다 = 만들던 중

    with pytest.raises(FileNotFoundError):
        HorizonTable.open(directory)
    assert find_table(tmp_path, spec()) is None


def test_find_table_requires_matching_parameters_and_a_covering_roi(
    built: tuple[Path, HorizonTable],
) -> None:
    directory, _ = built
    root = directory.parent

    assert find_table(root, spec()) is not None
    smaller = spec(roi=Roi(min_lat_deg=-90.0, max_lat_deg=-89.95))
    assert find_table(root, smaller) is not None  # 더 작은 ROI는 테이블이 덮는다
    assert find_table(root, spec(roi=Roi(min_lat_deg=-90.0, max_lat_deg=-89.8))) is None
    assert find_table(root, spec(max_range_m=20_000.0)) is None
    assert find_table(root, spec(azimuth_step_deg=5.0)) is None
    assert find_table(root, spec(observer_height_m=1.0)) is None
    assert find_table(root, spec(dem_id="other")) is None


def test_progress_is_reported_while_building(tmp_path: Path) -> None:
    events: list[tuple[int, int]] = []

    build_horizon_table(
        tmp_path / "t", spec(), synthetic_dem(), chunk_size=8,
        on_progress=lambda done, total: events.append((done, total)),
    )  # fmt: skip

    assert events and events[-1][0] == events[-1][1]
    assert [d for d, _ in events] == sorted(d for d, _ in events)
