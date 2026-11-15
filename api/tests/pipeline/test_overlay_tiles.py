"""오버레이 타일(horizon, normal): 파일로 쓴 PNG를 docs/api.md의 규약대로 읽어 검증한다."""

import json
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray
from png_decode import decode_png

from lunar_margin.engine.candidates.config import Roi
from lunar_margin.engine.candidates.horizon_table import (
    HorizonTable,
    HorizonTableSpec,
    build_horizon_table,
)
from lunar_margin.engine.candidates.projection import polar_xy_to_lonlat
from lunar_margin.engine.dem import PolarDem, RasterDem
from lunar_margin.engine.horizon import horizon_profile
from lunar_margin.pipeline.overlay_tiles import build_overlay_tiles
from lunar_margin.pipeline.pds_label import PolarGridLabel

N, C = 201, 100  # 100 m 격자, 극에서 +-10 km
SPACING_M = 500.0


def tilted_dem(east_per_m: float = 0.0, north_per_m: float = 0.0) -> PolarDem:
    """투영 평면에서 h = a*x + b*y 인 기울어진 평면 (a, b는 m/m)."""
    label = PolarGridLabel(N, N, 100.0, float(C), float(C), 1737.4, 1737.4, -90.0)
    rows, cols = np.mgrid[0:N, 0:N]
    x_m = (cols - C) * 100.0
    y_m = (C - rows) * 100.0
    heights_km = (east_per_m * x_m + north_per_m * y_m) / 1000.0
    return PolarDem(heights_km.astype(np.float32), label)


def build(dem: PolarDem, root: Path) -> tuple[HorizonTable, Path]:
    spec = HorizonTableSpec(
        dem_id="synthetic",
        roi=Roi(min_lat_deg=-90.0, max_lat_deg=-89.9),  # 극에서 약 3 km
        spacing_m=SPACING_M,
        azimuth_step_deg=1.0,
        max_range_m=5_000.0,
        observer_height_m=0.0,
    )
    build_horizon_table(root / "table", spec, dem)
    table = HorizonTable.open(root / "table")
    out = root / "tiles"
    build_overlay_tiles(table, dem, out)
    return table, out


def level0(out: Path, layer: str) -> tuple[dict[str, float], NDArray[np.uint8]]:
    meta = json.loads((out / layer / "meta.json").read_text())
    level = meta["levels"][0]
    _, _, image = decode_png((out / layer / "0" / "0" / "0.png").read_bytes())
    return level, image


def horizon_at(out: Path, col: int, row: int) -> NDArray[np.float64]:
    """규약: 셀 k(6열x3행)의 RGBA = 방위각 4k..4k+3 (5° 간격), v=0 없음, 고도 = -5 + 0.05*v."""
    level, image = level0(out, "horizon")
    tile = int(level["tile_px"])
    values: list[float] = []
    for k in range(18):
        cell_col, cell_row = k % 6, k // 6
        rgba = image[cell_row * tile + row, cell_col * tile + col]
        values.extend(float(v) for v in rgba)
    raw = np.array(values)
    return np.where(raw == 0, np.nan, -5.0 + 0.05 * raw)


def slopes_at(out: Path, col: int, row: int) -> tuple[float, float] | None:
    """규약: RG = 동쪽 경사 tan, BA = 북쪽 경사 tan, 각각 (u16 - 32768) / 16384. 모두 0이면 없음."""
    _, image = level0(out, "normal")
    r, g, b, a = (int(v) for v in image[row, col])
    if r == g == b == a == 0:
        return None
    return ((r * 256 + g) - 32768) / 16384, ((b * 256 + a) - 32768) / 16384


def pixel_of(out: Path, layer: str, ix: int, iy: int) -> tuple[int, int]:
    level, _ = level0(out, layer)
    center = int(level["center_px"])
    return center + ix, center - iy


def test_horizon_tiles_match_the_engine_horizon_every_5_degrees(tmp_path: Path) -> None:
    dem = tilted_dem(east_per_m=0.05)
    _, out = build(dem, tmp_path)

    for ix, iy in [(0, 0), (3, -2), (-4, 1)]:
        lat, lon = polar_xy_to_lonlat(np.array([ix * SPACING_M]), np.array([iy * SPACING_M]))
        expected = horizon_profile(
            dem, float(lat[0]), float(lon[0]), azimuth_step_deg=5.0, max_range_m=5_000.0
        ).elevation_deg
        col, row = pixel_of(out, "horizon", ix, iy)

        assert horizon_at(out, col, row) == pytest.approx(expected, abs=0.035)
    # 기울어진 평면이라 방위각마다 값이 달라야 의미 있는 검증이다
    assert np.ptp(expected) > 2.0


def test_normal_tiles_give_the_local_east_and_north_slope(tmp_path: Path) -> None:
    # 투영 평면에서 +x(경도 90° 방향)로 5% 오르는 평면
    _, out = build(tilted_dem(east_per_m=0.05), tmp_path)

    # 경도 0° 자오선 위(+y): 동쪽이 +x이므로 동쪽으로 5% 오르막, 남북 경사 없음
    on_lon0 = slopes_at(out, *pixel_of(out, "normal", 0, 4))
    # 경도 90° 자오선 위(+x): 북쪽(위도가 커지는, 극에서 멀어지는 방향)이 +x이므로
    # 북쪽으로 5% 오르막, 동서 경사 없음
    on_lon90 = slopes_at(out, *pixel_of(out, "normal", 4, 0))

    assert on_lon0 == pytest.approx((0.05, 0.0), abs=1e-4)
    assert on_lon90 == pytest.approx((0.0, 0.05), abs=1e-4)


def test_pixels_outside_the_table_roi_carry_no_data(tmp_path: Path) -> None:
    _, out = build(tilted_dem(east_per_m=0.05), tmp_path)

    # 정사각형 이미지의 모서리는 원형 ROI 밖이다
    assert np.isnan(horizon_at(out, 0, 0)).all()
    assert slopes_at(out, 0, 0) is None
    # ROI 안은 채워져 있다
    assert not np.isnan(horizon_at(out, *pixel_of(out, "horizon", 0, 0))).any()
    assert slopes_at(out, *pixel_of(out, "normal", 0, 0)) is not None


FINE_M = (200.0, 100.0)  # 합성 DEM(100 m 격자)에 맞춘 세밀 레벨


def build_fine(dem: PolarDem, root: Path) -> Path:
    spec = HorizonTableSpec(
        dem_id="synthetic",
        roi=Roi(min_lat_deg=-90.0, max_lat_deg=-89.9),
        spacing_m=SPACING_M,
        azimuth_step_deg=1.0,
        max_range_m=5_000.0,
        observer_height_m=0.0,
    )
    build_horizon_table(root / "table", spec, dem)
    out = root / "tiles"
    build_overlay_tiles(
        HorizonTable.open(root / "table"), dem, out, fine_pixel_sizes_m=FINE_M, fine_tile_px=16
    )
    return out


def fine_slopes_at(out: Path, z: int, x_m: float, y_m: float) -> tuple[float, float] | None:
    """규약: 레벨 픽셀 (col, row) = (center + x/px, center - y/px), 타일 = 픽셀 // tile_px."""
    level = json.loads((out / "normal" / "meta.json").read_text())["levels"][z]
    px, center, tile = level["pixel_size_m"], int(level["center_px"]), int(level["tile_px"])
    col, row = center + round(x_m / px), center - round(y_m / px)
    path = out / "normal" / str(z) / str(col // tile) / f"{row // tile}.png"
    _, _, image = decode_png(path.read_bytes())
    r, g, b, a = (int(v) for v in image[row % tile, col % tile])
    if r == g == b == a == 0:
        return None
    return ((r * 256 + g) - 32768) / 16384, ((b * 256 + a) - 32768) / 16384


def test_fine_normal_levels_are_listed_from_coarse_to_fine_and_cover_the_roi(
    tmp_path: Path,
) -> None:
    out = build_fine(tilted_dem(east_per_m=0.05), tmp_path)

    levels = json.loads((out / "normal" / "meta.json").read_text())["levels"]

    assert [level["z"] for level in levels] == [0, 1, 2]
    assert [level["pixel_size_m"] for level in levels] == [SPACING_M, *FINE_M]
    base = levels[0]
    for level in levels[1:]:
        # 레벨 0과 같은 영역(극에서 center*pixel_size)을 덮고, 정사각형 타일로 빠짐없이 나뉜다
        assert level["center_px"] * level["pixel_size_m"] >= base["center_px"] * SPACING_M
        assert level["size_px"] == 2 * level["center_px"] + 1
        assert level["tile_px"] == 16
        assert level["tiles_per_side"] * 16 >= level["size_px"]
        assert (level["tiles_per_side"] - 1) * 16 < level["size_px"]
        for x in range(level["tiles_per_side"]):
            for y in range(level["tiles_per_side"]):
                tile = out / "normal" / str(level["z"]) / str(x) / f"{y}.png"
                width, height, _ = decode_png(tile.read_bytes())
                assert (width, height) == (16, 16)


def test_fine_normal_tiles_give_the_local_slope_in_every_tile(tmp_path: Path) -> None:
    # 투영 평면에서 +x(경도 90° 방향)로 5% 오르는 평면
    out = build_fine(tilted_dem(east_per_m=0.05), tmp_path)

    for z in (1, 2):
        # 서로 다른 타일에 떨어지는 네 지점: 경도 0°(+y), 90°(+x), 180°(-y), 270°(-x) 자오선 위
        assert fine_slopes_at(out, z, 0.0, 2000.0) == pytest.approx((0.05, 0.0), abs=1e-4)
        assert fine_slopes_at(out, z, 2000.0, 0.0) == pytest.approx((0.0, 0.05), abs=1e-4)
        assert fine_slopes_at(out, z, 0.0, -2000.0) == pytest.approx((-0.05, 0.0), abs=1e-4)
        assert fine_slopes_at(out, z, -2000.0, 0.0) == pytest.approx((0.0, -0.05), abs=1e-4)


def test_fine_levels_fill_the_whole_square_and_pad_the_last_tiles_with_no_data(
    tmp_path: Path,
) -> None:
    out = build_fine(tilted_dem(east_per_m=0.05), tmp_path)
    level = json.loads((out / "normal" / "meta.json").read_text())["levels"][2]
    edge_m = level["center_px"] * level["pixel_size_m"]

    # 원형 ROI 밖인 정사각형 모서리에도 DEM이 있으면 값이 있다
    # (선형 필터링이 가장자리에서 깨지지 않게)
    assert fine_slopes_at(out, 2, edge_m, edge_m) is not None
    # 레벨 이미지(size_px) 밖의 타일 여백은 데이터 없음
    last = level["tiles_per_side"] - 1
    _, _, image = decode_png((out / "normal" / "2" / str(last) / f"{last}.png").read_bytes())
    assert level["size_px"] % 16 != 0 and not image[15, 15].any()


def detail_region(east_per_m: float = 0.05) -> RasterDem:
    """x 500~1500 m, y -400~600 m를 덮는 5 m 래스터. 투영 평면에서 +x로 east_per_m만큼 오른다."""
    cols = np.arange(200)
    heights = np.tile(east_per_m * (500.0 + (cols + 0.5) * 5.0), (200, 1)).astype(np.float32)
    return RasterDem(heights, left_m=500.0, top_m=600.0, pixel_size_m=5.0)


def build_detail(root: Path, regions: list[RasterDem]) -> Path:
    spec = HorizonTableSpec(
        dem_id="synthetic",
        roi=Roi(min_lat_deg=-90.0, max_lat_deg=-89.9),
        spacing_m=SPACING_M,
        azimuth_step_deg=1.0,
        max_range_m=5_000.0,
        observer_height_m=0.0,
    )
    dem = tilted_dem()  # 바탕 지형은 평평하다
    build_horizon_table(root / "table", spec, dem)
    out = root / "tiles"
    build_overlay_tiles(
        HorizonTable.open(root / "table"),
        dem,
        out,
        fine_pixel_sizes_m=FINE_M,
        fine_tile_px=16,
        detail=regions,
    )
    return out


def test_detail_levels_follow_the_fine_levels_and_list_where_they_have_tiles(
    tmp_path: Path,
) -> None:
    out = build_detail(tmp_path, [detail_region()])

    levels = json.loads((out / "normal" / "meta.json").read_text())["levels"]

    assert [level["pixel_size_m"] for level in levels] == [SPACING_M, *FINE_M, 20.0, 5.0]
    assert [level["z"] for level in levels] == [0, 1, 2, 3, 4]
    assert all("tile_ranges" not in level for level in levels[:3])
    # 지역의 값이 있는 범위(바깥 픽셀 중심)는 x 502.5~1497.5 m, y -397.5~597.5 m.
    # 그 안에 중심이 드는 픽셀을 가진 타일 범위 [x0, y0, x1, y1] (양 끝 포함, 타일 16px):
    #   20 m (center 150): 열 176~224, 행 121~169 / 5 m (center 600): 열 701~899, 행 481~679
    assert levels[3]["center_px"] == 150 and levels[4]["center_px"] == 600
    assert levels[3]["tile_ranges"] == [[11, 7, 14, 10]]
    assert levels[4]["tile_ranges"] == [[43, 30, 56, 42]]
    for level in levels[3:]:
        x0, y0, x1, y1 = level["tile_ranges"][0]
        # 범위 안의 타일은 모두 있고, 범위 밖 타일은 만들지 않는다
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                assert (out / "normal" / str(level["z"]) / str(x) / f"{y}.png").is_file()
        assert not (out / "normal" / str(level["z"]) / str(x0 - 1) / f"{y0}.png").exists()
        assert not (out / "normal" / str(level["z"]) / "0" / "0.png").exists()


def test_detail_tiles_carry_the_slopes_of_the_region_and_nothing_outside_it(
    tmp_path: Path,
) -> None:
    out = build_detail(tmp_path, [detail_region(east_per_m=0.05)])

    for z in (3, 4):
        # (1000, 100): 경도 = atan2(1000, 100). +x로 5% 오르는 평면을 그 지점의 동·북으로 나누면
        # 동 = 0.05 * cos(경도), 북 = 0.05 * sin(경도)
        lon = np.arctan2(1000.0, 100.0)
        expected = (0.05 * np.cos(lon), 0.05 * np.sin(lon))
        assert fine_slopes_at(out, z, 1000.0, 100.0) == pytest.approx(expected, abs=2e-4)
        # 지역 밖(바탕 지형만 있는 곳)은 같은 타일 안이어도 데이터 없음
        assert fine_slopes_at(out, z, 1000.0, 600.0) is None
        assert fine_slopes_at(out, z, 1500.0, 100.0) is None


def test_where_two_regions_overlap_the_first_one_wins_and_gaps_are_filled(
    tmp_path: Path,
) -> None:
    first = detail_region(east_per_m=0.05)
    first_heights = np.tile(0.05 * (500.0 + (np.arange(200) + 0.5) * 5.0), (200, 1)).astype(
        np.float32
    )
    first_heights[:, 150:] = np.nan  # x 1250 m부터는 값이 없다
    first = RasterDem(first_heights, left_m=500.0, top_m=600.0, pixel_size_m=5.0)
    second = detail_region(east_per_m=-0.02)

    out = build_detail(tmp_path, [first, second])

    lon_a, lon_b = np.arctan2(1000.0, 100.0), np.arctan2(1400.0, 100.0)
    assert fine_slopes_at(out, 4, 1000.0, 100.0) == pytest.approx(
        (0.05 * np.cos(lon_a), 0.05 * np.sin(lon_a)), abs=2e-4
    )
    assert fine_slopes_at(out, 4, 1400.0, 100.0) == pytest.approx(
        (-0.02 * np.cos(lon_b), -0.02 * np.sin(lon_b)), abs=2e-4
    )


def test_a_region_outside_the_roi_circle_gets_no_tiles(tmp_path: Path) -> None:
    # ROI는 극에서 3 km인 원이다. 정사각형 격자의 모서리 쪽(2.2~2.9 km, 2.2~2.9 km)은
    # 격자 안이지만 원 밖(극에서 3.1 km 이상)이라 뷰어가 조명하지 않는다
    heights = np.zeros((140, 140), dtype=np.float32)
    corner = RasterDem(heights, left_m=2200.0, top_m=2900.0, pixel_size_m=5.0)

    out = build_detail(tmp_path, [corner, detail_region()])

    levels = json.loads((out / "normal" / "meta.json").read_text())["levels"]
    assert levels[4]["tile_ranges"] == [[43, 30, 56, 42]]  # detail_region의 범위만
    only_corner = build_detail(tmp_path / "corner", [corner])
    corner_levels = json.loads((only_corner / "normal" / "meta.json").read_text())["levels"]
    assert [level["z"] for level in corner_levels] == [0, 1, 2]
