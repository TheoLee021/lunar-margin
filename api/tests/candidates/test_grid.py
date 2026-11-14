import math

import numpy as np
import pytest

from lunar_margin.engine.candidates.config import Roi
from lunar_margin.engine.candidates.grid import polar_grid, refine_points
from lunar_margin.engine.candidates.projection import lonlat_to_polar_xy, polar_radius_m

ROI = Roi(min_lat_deg=-90.0, max_lat_deg=-89.9)  # 극에서 약 3.03 km


def brute_force_count(spacing: float, rho_max: float, rho_min: float = 0.0) -> int:
    n = int(rho_max // spacing) + 1
    count = 0
    for ix in range(-n, n + 1):
        for iy in range(-n, n + 1):
            rho = math.hypot(ix * spacing, iy * spacing)
            if rho_min <= rho <= rho_max:
                count += 1
    return count


def test_point_count_matches_brute_force_lattice() -> None:
    sites = polar_grid(ROI, 500.0)

    assert len(sites) == brute_force_count(500.0, polar_radius_m(-89.9))


def test_every_point_is_inside_the_roi_and_on_the_lattice() -> None:
    sites = polar_grid(ROI, 500.0)

    assert np.all(sites.lat_deg <= -89.9 + 1e-9) and np.all(sites.lat_deg >= -90.0)
    assert np.allclose(sites.x_m, sites.ix * 500.0) and np.allclose(sites.y_m, sites.iy * 500.0)
    x, y = lonlat_to_polar_xy(sites.lat_deg, sites.lon_deg)
    assert np.allclose(x, sites.x_m, atol=1e-6) and np.allclose(y, sites.y_m, atol=1e-6)


def test_pole_is_included_and_order_is_deterministic_row_major() -> None:
    a, b = polar_grid(ROI, 500.0), polar_grid(ROI, 500.0)

    assert np.array_equal(a.ix, b.ix) and np.array_equal(a.iy, b.iy)
    assert bool(np.any((a.ix == 0) & (a.iy == 0)))
    order = np.lexsort((a.ix, a.iy))
    assert np.array_equal(order, np.arange(len(a)))  # 이미 (iy, ix) 순서


def test_inner_boundary_excludes_points_closer_than_min_lat() -> None:
    ring = polar_grid(Roi(min_lat_deg=-89.95, max_lat_deg=-89.9), 250.0)

    assert np.all(np.hypot(ring.x_m, ring.y_m) >= polar_radius_m(-89.95) - 1e-6)
    assert not np.any((ring.ix == 0) & (ring.iy == 0))


def test_boundary_point_exactly_on_the_outer_edge_is_kept() -> None:
    # 반경 = 격자 간격의 정수배가 되는 위도를 만들어 경계 포함 여부를 확인한다
    spacing = 500.0
    lat = -90.0 + math.degrees(2.0 * math.atan(2000.0 / (2.0 * 1_737_400.0)))  # rho = 2000 m
    sites = polar_grid(Roi(min_lat_deg=-90.0, max_lat_deg=lat), spacing)

    assert bool(np.any((sites.ix == 4) & (sites.iy == 0)))


def test_coarse_lattice_is_a_subset_of_the_fine_lattice() -> None:
    fine = polar_grid(ROI, 500.0)
    coarse = polar_grid(ROI, 1000.0)

    fine_keys = {(int(i), int(j)) for i, j in zip(fine.ix, fine.iy, strict=True)}
    for i, j in zip(coarse.ix * 2, coarse.iy * 2, strict=True):
        assert (int(i), int(j)) in fine_keys


def test_refine_points_cover_neighbourhoods_without_duplicates() -> None:
    coarse = polar_grid(ROI, 1000.0)
    pick = (coarse.ix == 1) & (coarse.iy == 0)  # 극에서 동쪽(+x)으로 1 km 떨어진 한 점

    fine = refine_points(coarse, pick, ROI, 500.0)

    keys = {(int(i), int(j)) for i, j in zip(fine.ix, fine.iy, strict=True)}
    assert len(keys) == len(fine)  # 중복 없음
    assert (2, 0) in keys  # 선택한 거친 점 자체 (x = 1000 m = 정수 2칸)
    assert (3, 1) in keys and (1, -1) in keys  # 이웃 칸 ±1 (거친 간격 안)
    assert fine.spacing_m == 500.0
    assert all(abs(i - 2) <= 2 and abs(j) <= 2 for i, j in keys)  # 거친 간격(2칸) 이내만


def test_refine_points_are_clipped_to_the_roi() -> None:
    coarse = polar_grid(ROI, 1000.0)
    radius = np.hypot(coarse.x_m, coarse.y_m)
    edge = radius == radius.max()

    fine = refine_points(coarse, edge, ROI, 500.0)

    assert np.all(np.hypot(fine.x_m, fine.y_m) <= polar_radius_m(-89.9) + 1e-6)


def test_refine_requires_a_whole_ratio() -> None:
    coarse = polar_grid(ROI, 1000.0)

    with pytest.raises(ValueError, match="multiple"):
        refine_points(coarse, np.ones(len(coarse), dtype=np.bool_), ROI, 400.0)


def test_subset_keeps_provenance() -> None:
    sites = polar_grid(ROI, 500.0)

    part = sites.subset(sites.ix == 0)

    assert part.plan_id == sites.plan_id and part.spacing_m == 500.0
    assert len(part) == np.count_nonzero(sites.ix == 0)
