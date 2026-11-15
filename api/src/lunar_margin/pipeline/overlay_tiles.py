"""렌더링용 오버레이 타일: 수평선 테이블과 DEM을 셰이더가 읽는 PNG로 굽는다.

규약은 docs/api.md의 Tiles 절. 격자는 수평선 테이블과 같고(극 입체투영, 격자 한 칸이 한 픽셀),
경도 0°가 위쪽, 동쪽(경도 90°)이 오른쪽이다.

실행: uv run python -m lunar_margin.pipeline.overlay_tiles [--config cfg.json] [--wide-only]
먼저 같은 설정으로 `python -m lunar_margin.pipeline.horizons`를 돌려 수평선 테이블을 만들어 둔다.
60°S까지의 DEM(`pipeline.fetch --wide`)이 있으면 넓은 구역의 경사(normal-wide)도 굽는다.
"""

import argparse
import json
import math
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.engine.candidates.field import open_dem
from lunar_margin.engine.candidates.grid import polar_grid
from lunar_margin.engine.candidates.horizon_table import HorizonTable, find_table
from lunar_margin.engine.dem import Dem, HeightField, LayeredHeights, PolarDem, RasterDem
from lunar_margin.pipeline.geotiff import read_float_geotiff
from lunar_margin.pipeline.horizons import TABLES_DIR, resolve_dems, table_spec_for
from lunar_margin.pipeline.png import encode_png
from lunar_margin.pipeline.sources import DEM_SOURCES, WIDE_DEM

FORMAT_VERSION = 1

AZIMUTH_STEP_DEG = 5.0
AZIMUTHS = 72
ATLAS_COLS, ATLAS_ROWS = 6, 3  # 셀 18개 x RGBA 4채널 = 방위각 72개
HORIZON_OFFSET_DEG = -5.0
HORIZON_STEP_DEG = 0.05
NORMAL_BIAS, NORMAL_SCALE = 32768, 16384  # tan = (u16 - bias) / scale, +-2 범위
# normal 레이어의 세밀 레벨 (z = 1, 2, ...). 레벨 0(수평선 격자)과 같은 영역을 더 촘촘히 덮는다
FINE_PIXEL_SIZES_M = (160.0, 80.0)
FINE_TILE_PX = 256
# 5 m 지역 DEM(Shape-from-Shading)이 있는 곳에만 더 붙는 레벨. 그 지역을 덮는 타일만 만든다
DETAIL_PIXEL_SIZES_M = (20.0, 5.0)
SFS_DIR = "sfs"
# 넓은 구역: 85°S 밖도 뷰어가 햇빛으로 그리도록 60°S까지 덮는 별도 레이어 (경사 한 장).
# 극 입체투영에서 60°S는 극에서 2R tan(15°) = 약 931 km다
WIDE_LAYER = "normal-wide"
WIDE_MAX_LAT_DEG = -60.0
# 첫 화면(픽셀당 약 660 m)에서 640 m와 거의 같아 보이고 한 장으로 받을 만한 크기(약 14 MB)다
WIDE_PIXEL_SIZE_M = 960.0
# 그 구역의 햇빛 지도 격자 (GET /sunlight/south-pole-wide.png)
WIDE_SUNLIGHT_PIXEL_SIZE_M = 640.0
# 넓은 구역 DEM(240 m)의 간격. 경사는 이 간격으로 재서 픽셀 안에서 평균한다
WIDE_SAMPLE_STEP_M = 240.0
_WIDE_CHUNK_ROWS = 256


def detail_dem_paths(data_dir: Path) -> list[Path]:
    """받아 둔 5 m 지역 DEM 파일들 (없으면 빈 목록. `pipeline.fetch --sfs`로 받는다)."""
    return sorted((data_dir / "dem" / SFS_DIR).glob("*_GLDELEV_005.tif"))


def open_detail_dem(path: Path, radius_m: float) -> RasterDem:
    raster = read_float_geotiff(path)
    return RasterDem(
        raster.heights,
        left_m=raster.left_m,
        top_m=raster.top_m,
        pixel_size_m=raster.pixel_size_m,
        radius_m=radius_m,
    )


def _write_png(path: Path, rgba: NDArray[np.uint8]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encode_png(rgba))


def _write_meta(directory: Path, meta: dict[str, object]) -> None:
    # meta.json을 마지막에 써서 만들던 중인 레이어는 제공되지 않게 한다
    (directory / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def _slopes(
    dem: HeightField, x: NDArray[np.float64], y: NDArray[np.float64], step: float
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """투영 평면 (x, y)에서의 지역 동쪽·북쪽 경사(tan). DEM 밖은 NaN.

    투영 평면 중앙차분 -> 입체투영 축척 보정 -> 지역 동·북 방향.
    """
    gx = (dem.sample_height_m(x + step, y) - dem.sample_height_m(x - step, y)) / (2 * step)
    gy = (dem.sample_height_m(x, y + step) - dem.sample_height_m(x, y - step)) / (2 * step)
    scale = 1.0 + (np.hypot(x, y) / (2.0 * dem.radius_m)) ** 2  # 평면 거리 = 지면 거리 * k
    gx, gy = gx * scale, gy * scale
    lon = np.arctan2(x, y)  # 극에서는 0
    east = gx * np.cos(lon) - gy * np.sin(lon)  # 동쪽 단위벡터 (cos, -sin)
    # 북쪽 = 위도가 커지는 방향 = 남극에서 멀어지는 방향 (엔진 방위각 0°와 같다)
    north = gx * np.sin(lon) + gy * np.cos(lon)  # 북쪽 단위벡터 (sin, cos)
    return east, north


def _encode_slopes(east: NDArray[np.float64], north: NDArray[np.float64]) -> NDArray[np.uint8]:
    """(..., 4) uint8: RG = 동쪽, BA = 북쪽 경사의 16비트 값. 값이 없는 곳은 모두 0."""
    rgba = np.zeros((*east.shape, 4), dtype=np.uint8)
    ok = np.isfinite(east) & np.isfinite(north)
    for channel, slope in ((0, east), (2, north)):
        word = np.clip(np.round(slope[ok] * NORMAL_SCALE + NORMAL_BIAS), 1, 65535).astype(np.int64)
        rgba[ok, channel] = (word >> 8).astype(np.uint8)
        rgba[ok, channel + 1] = (word & 0xFF).astype(np.uint8)
    return rgba


def _write_fine_normal_level(
    directory: Path, z: int, dem: Dem, radius_m: float, pixel_size_m: float, tile_px: int
) -> dict[str, object]:
    """극에서 radius_m까지 덮는 정사각형 레벨을 타일로 쓰고 meta의 레벨 항목을 돌려준다.

    원형 ROI 밖 모서리도 DEM이 있으면 채운다. 레벨 이미지 밖의 타일 여백만 데이터 없음이다.
    """
    center = math.ceil(radius_m / pixel_size_m)
    size = 2 * center + 1
    tiles_per_side = -(-size // tile_px)
    for tile_x in range(tiles_per_side):
        for tile_y in range(tiles_per_side):
            col, row = np.meshgrid(
                np.arange(tile_x * tile_px, (tile_x + 1) * tile_px),
                np.arange(tile_y * tile_px, (tile_y + 1) * tile_px),
            )
            x = (col - center).astype(np.float64) * pixel_size_m
            y = (center - row).astype(np.float64) * pixel_size_m
            east, north = _slopes(dem, x, y, pixel_size_m)
            east[(col >= size) | (row >= size)] = np.nan
            _write_png(
                directory / str(z) / str(tile_x) / f"{tile_y}.png", _encode_slopes(east, north)
            )
    return {
        "z": z,
        "pixel_size_m": pixel_size_m,
        "size_px": size,
        "center_px": center,
        "tile_px": tile_px,
        "tiles_per_side": tiles_per_side,
    }


def _mean_slopes(
    dem: HeightField,
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    pixel_size_m: float,
    sample_step_m: float,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """sample_step_m 간격으로 잰 경사를 pixel_size_m 픽셀 안에서 평균한다 (DEM 밖이 섞이면 NaN)."""
    n = max(1, round(pixel_size_m / sample_step_m))
    east = np.zeros_like(x)
    north = np.zeros_like(x)
    for offset_x in (np.arange(n) + 0.5) / n - 0.5:
        for offset_y in (np.arange(n) + 0.5) / n - 0.5:
            sub_east, sub_north = _slopes(
                dem, x + offset_x * pixel_size_m, y + offset_y * pixel_size_m, sample_step_m
            )
            east += sub_east
            north += sub_north
    return east / (n * n), north / (n * n)


def _region_slopes(
    region: RasterDem, x: NDArray[np.float64], y: NDArray[np.float64], pixel_size_m: float
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """지역 DEM의 원래 간격으로 잰 경사를 pixel_size_m 픽셀 안에서 평균한다 (밖이 섞이면 NaN)."""
    return _mean_slopes(region, x, y, pixel_size_m, region.pixel_size_m)


def _write_detail_normal_level(
    directory: Path,
    z: int,
    regions: Sequence[RasterDem],
    radius_m: float,
    pixel_size_m: float,
    tile_px: int,
) -> dict[str, object] | None:
    """지역 DEM들이 덮는 타일만 쓰고 meta의 레벨 항목을 돌려준다. 격자는 세밀 레벨과 같은 방식이다.

    `tile_ranges`는 지역마다 그 지역의 값이 있을 수 있는 타일 범위 [x0, y0, x1, y1](양 끝 포함)이고,
    범위 안의 타일은 모두 만든다. 지역이 겹치면 앞선 지역의 값을 쓰고 빈 곳만 다음 지역으로 채운다.
    격자 안에 드는 지역이 하나도 없으면 None.
    """
    center = math.ceil(radius_m / pixel_size_m)
    size = 2 * center + 1
    tiles_per_side = -(-size // tile_px)
    ranges: list[tuple[int, int, int, int]] = []
    covering: dict[tuple[int, int], list[RasterDem]] = {}
    for region in regions:
        left, bottom, right, top = region.bounds_m
        col0 = max(math.ceil(center + left / pixel_size_m), 0)
        col1 = min(math.floor(center + right / pixel_size_m), size - 1)
        row0 = max(math.ceil(center - top / pixel_size_m), 0)
        row1 = min(math.floor(center - bottom / pixel_size_m), size - 1)
        nearest_m = math.hypot(max(left, -right, 0.0), max(bottom, -top, 0.0))
        if col0 > col1 or row0 > row1 or nearest_m >= radius_m:
            continue  # ROI(극에서 radius_m인 원) 밖의 지역
        tile_range = (col0 // tile_px, row0 // tile_px, col1 // tile_px, row1 // tile_px)
        ranges.append(tile_range)
        for tile_x in range(tile_range[0], tile_range[2] + 1):
            for tile_y in range(tile_range[1], tile_range[3] + 1):
                covering.setdefault((tile_x, tile_y), []).append(region)
    if not ranges:
        return None
    for (tile_x, tile_y), tile_regions in covering.items():
        col, row = np.meshgrid(
            np.arange(tile_x * tile_px, (tile_x + 1) * tile_px),
            np.arange(tile_y * tile_px, (tile_y + 1) * tile_px),
        )
        x = (col - center).astype(np.float64) * pixel_size_m
        y = (center - row).astype(np.float64) * pixel_size_m
        east = np.full(x.shape, np.nan)
        north = np.full(x.shape, np.nan)
        for region in tile_regions:
            region_east, region_north = _region_slopes(region, x, y, pixel_size_m)
            empty = np.isnan(east) | np.isnan(north)
            east = np.where(empty, region_east, east)
            north = np.where(empty, region_north, north)
        east[(col >= size) | (row >= size)] = np.nan
        _write_png(directory / str(z) / str(tile_x) / f"{tile_y}.png", _encode_slopes(east, north))
    return {
        "z": z,
        "pixel_size_m": pixel_size_m,
        "size_px": size,
        "center_px": center,
        "tile_px": tile_px,
        "tiles_per_side": tiles_per_side,
        "tile_ranges": [list(tile_range) for tile_range in ranges],
    }


def open_wide_dem(data_dir: Path, dem: HeightField) -> HeightField | None:
    """dem의 값을 쓰고 그 밖은 60°S까지 덮는 240 m DEM으로 메운 높이.

    그 DEM을 받지 않았으면 None (`pipeline.fetch --wide`로 받는다).
    """
    img, lbl = (data_dir / "dem" / source.filename for source in DEM_SOURCES[WIDE_DEM])
    if not (img.is_file() and lbl.is_file()):
        return None
    return LayeredHeights([dem, PolarDem.from_files(img, lbl)])


def wide_radius_m(radius_m: float) -> float:
    """반경 radius_m인 구에서 넓은 구역의 바깥 경계(60°S)까지, 극 입체투영 평면의 거리."""
    return 2.0 * radius_m * math.tan(math.radians(90.0 + WIDE_MAX_LAT_DEG) / 2.0)


def build_wide_normal_tiles(
    dem: HeightField,
    out: Path,
    *,
    radius_m: float | None = None,
    pixel_size_m: float = WIDE_PIXEL_SIZE_M,
    sunlight_pixel_size_m: float = WIDE_SUNLIGHT_PIXEL_SIZE_M,
    sample_step_m: float = WIDE_SAMPLE_STEP_M,
) -> None:
    """극에서 radius_m(기본 60°S)까지의 경사를 out/normal-wide/에 타일 한 장으로 쓴다.

    픽셀 값은 sample_step_m 간격으로 잰 경사를 그 픽셀 안에서 평균한 것이다. meta.json의
    `sunlight`는 같은 구역의 햇빛 지도 격자다. DEM 밖은 데이터 없음이다.
    """
    radius = wide_radius_m(dem.radius_m) if radius_m is None else radius_m
    center = math.ceil(radius / pixel_size_m)
    size = 2 * center + 1
    rgba = np.zeros((size, size, 4), dtype=np.uint8)
    for start in range(0, size, _WIDE_CHUNK_ROWS):  # 한 번에 다 하면 수백 MB를 쓴다
        col, row = np.meshgrid(
            np.arange(size), np.arange(start, min(start + _WIDE_CHUNK_ROWS, size))
        )
        x = (col - center).astype(np.float64) * pixel_size_m
        y = (center - row).astype(np.float64) * pixel_size_m
        rgba[start : start + _WIDE_CHUNK_ROWS] = _encode_slopes(
            *_mean_slopes(dem, x, y, pixel_size_m, sample_step_m)
        )
    _write_png(out / WIDE_LAYER / "0" / "0" / "0.png", rgba)
    sunlight_center = math.ceil(radius / sunlight_pixel_size_m)
    _write_meta(
        out / WIDE_LAYER,
        {
            "version": FORMAT_VERSION,
            "layer": WIDE_LAYER,
            "levels": [
                {
                    "z": 0,
                    "pixel_size_m": pixel_size_m,
                    "size_px": size,
                    "center_px": center,
                    "tile_px": size,
                    "tiles_per_side": 1,
                }
            ],
            "encoding": {"bias": NORMAL_BIAS, "scale": NORMAL_SCALE},
            "sunlight": {
                "pixel_size_m": sunlight_pixel_size_m,
                "size_px": 2 * sunlight_center + 1,
                "center_px": sunlight_center,
            },
        },
    )


def build_overlay_tiles(
    table: HorizonTable,
    dem: Dem,
    out: Path,
    *,
    fine_pixel_sizes_m: Sequence[float] = FINE_PIXEL_SIZES_M,
    fine_tile_px: int = FINE_TILE_PX,
    detail: Sequence[RasterDem] = (),
    detail_pixel_sizes_m: Sequence[float] = DETAIL_PIXEL_SIZES_M,
) -> None:
    """table의 격자로 out/{horizon,normal}/의 meta.json과 타일을 쓴다.

    레벨 0은 두 레이어 모두 table 격자 그대로 타일 한 장이다. normal에는 같은 영역을
    fine_pixel_sizes_m 간격으로 덮는 레벨이 fine_tile_px 타일로 더 붙고, detail(5 m 지역 DEM)이
    있으면 그 지역만 덮는 detail_pixel_sizes_m 레벨이 그 뒤에 붙는다.
    """
    spec = table.spec
    stride = round(AZIMUTH_STEP_DEG / spec.azimuth_step_deg)
    if abs(stride * spec.azimuth_step_deg - AZIMUTH_STEP_DEG) > 1e-9:
        raise ValueError(f"the table azimuth step must divide {AZIMUTH_STEP_DEG}°")

    sites = polar_grid(spec.roi, spec.spacing_m)
    center = int(max(np.abs(sites.ix).max(), np.abs(sites.iy).max()))
    size = 2 * center + 1
    cols = sites.ix + center
    rows = center - sites.iy

    level = {
        "z": 0,
        "pixel_size_m": spec.spacing_m,
        "size_px": size,
        "center_px": center,
        "tile_px": size,
        "tiles_per_side": 1,
    }

    # 수평선: (size, size, 72) uint8, 0 = 없음
    codes = np.zeros((size, size, AZIMUTHS), dtype=np.uint8)
    table_rows = table.rows_for(sites)
    for k in np.flatnonzero(table_rows >= 0):
        elevation = table.profile(int(table_rows[k])).elevation_deg[::stride]
        code = np.round((elevation - HORIZON_OFFSET_DEG) / HORIZON_STEP_DEG)
        codes[rows[k], cols[k]] = np.clip(code, 1, 255).astype(np.uint8)
    atlas = np.zeros((ATLAS_ROWS * size, ATLAS_COLS * size, 4), dtype=np.uint8)
    for cell in range(ATLAS_COLS * ATLAS_ROWS):
        r0, c0 = (cell // ATLAS_COLS) * size, (cell % ATLAS_COLS) * size
        atlas[r0 : r0 + size, c0 : c0 + size] = codes[:, :, 4 * cell : 4 * cell + 4]
    _write_png(out / "horizon" / "0" / "0" / "0.png", atlas)
    _write_meta(
        out / "horizon",
        {
            "version": FORMAT_VERSION,
            "layer": "horizon",
            "levels": [level],
            "encoding": {
                "azimuth_step_deg": AZIMUTH_STEP_DEG,
                "azimuths": AZIMUTHS,
                "atlas_cols": ATLAS_COLS,
                "atlas_rows": ATLAS_ROWS,
                "offset_deg": HORIZON_OFFSET_DEG,
                "step_deg": HORIZON_STEP_DEG,
            },
        },
    )

    # 법선 레벨 0: 수평선과 같은 격자, ROI 안의 지점만
    normal = np.zeros((size, size, 4), dtype=np.uint8)
    normal[rows, cols] = _encode_slopes(*_slopes(dem, sites.x_m, sites.y_m, spec.spacing_m))
    _write_png(out / "normal" / "0" / "0" / "0.png", normal)
    fine_levels = [
        _write_fine_normal_level(
            out / "normal", z, dem, center * spec.spacing_m, pixel_size_m, fine_tile_px
        )
        for z, pixel_size_m in enumerate(fine_pixel_sizes_m, start=1)
    ]
    for pixel_size_m in detail_pixel_sizes_m if detail else ():
        detail_level = _write_detail_normal_level(
            out / "normal",
            len(fine_levels) + 1,
            detail,
            center * spec.spacing_m,
            pixel_size_m,
            fine_tile_px,
        )
        if detail_level is not None:
            fine_levels.append(detail_level)
    _write_meta(
        out / "normal",
        {
            "version": FORMAT_VERSION,
            "layer": "normal",
            "levels": [level, *fine_levels],
            "encoding": {"bias": NORMAL_BIAS, "scale": NORMAL_SCALE},
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="SearchConfig JSON (생략하면 기본값)")
    parser.add_argument(
        "--wide-only",
        action="store_true",
        help="normal-wide 레이어만 굽는다 (수평선 테이블이 필요 없고 다른 타일은 그대로 둔다)",
    )
    args = parser.parse_args()
    config = (
        SearchConfig.model_validate_json(args.config.read_text()) if args.config else SearchConfig()
    )
    data_dir = Settings().data_dir
    dem = open_dem(resolve_dems(config, data_dir).pairs)
    if not args.wide_only:
        table = find_table(data_dir / TABLES_DIR, table_spec_for(config, data_dir))
        if table is None:
            raise SystemExit(
                "수평선 테이블이 없습니다. "
                "먼저 `uv run python -m lunar_margin.pipeline.horizons`를 실행하세요"
            )
        detail = [open_detail_dem(path, dem.radius_m) for path in detail_dem_paths(data_dir)]
        print(f"5 m 지역 DEM {len(detail)}개 (없으면 `pipeline.fetch --sfs`로 받는다)")
        build_overlay_tiles(table, dem, data_dir / "tiles", detail=detail)
    wide = open_wide_dem(data_dir, dem)
    if wide is None:
        print("60°S까지의 DEM이 없어 normal-wide는 건너뜀 (`pipeline.fetch --wide`로 받는다)")
    else:
        build_wide_normal_tiles(wide, data_dir / "tiles")
    print(f"완료: {data_dir / 'tiles'}")


if __name__ == "__main__":
    main()
