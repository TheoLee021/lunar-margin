"""GET /sunlight/south-pole.png?x=&y=&z=: 태양 방향 하나에 대한 남극 햇빛 지도 (계약: docs/api.md).
GET /sunlight/south-pole/{level}/{tile_x}/{tile_y}.png?x=&y=&z=: 그 지도의 세밀한 창.

지형 그림자는 태양 방향마다 달라서 미리 구워 둘 수 없다. 요청이 오면 DEM으로 계산하고
(85°S 이남 80 m 격자에 약 3초), 최근 결과 몇 개만 메모리에 둔다.

5 m 지역 DEM이 있는 곳은 80 m 지도로는 그림자가 뭉툭하다. 그렇다고 지역 하나를 5 m로 통째로
계산하면 수십 초가 걸리므로, 클라이언트가 보는 곳 주변의 창(4x4 타일, 5 m 레벨에서 5 km)만
그 레벨의 격자로 계산한다 (약 1초). 창 밖 지형의 그림자도 창 안에 그대로 드리운다.
"""

import json
import math
from collections import OrderedDict
from collections.abc import Callable, Hashable, Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache, partial
from pathlib import Path
from threading import BoundedSemaphore, Lock
from typing import Annotated, Protocol, Self

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, model_validator

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.engine.candidates.field import open_dem
from lunar_margin.engine.dem import Dem, HeightField, LayeredHeights, RasterDem
from lunar_margin.engine.sunlight import GridWindow, SunlightGrid, sunlit_fraction
from lunar_margin.pipeline.geotiff import read_geotiff_bounds
from lunar_margin.pipeline.horizons import resolve_dems
from lunar_margin.pipeline.overlay_tiles import detail_dem_paths, open_detail_dem
from lunar_margin.pipeline.png import encode_png

Direction = tuple[float, float, float]

router = APIRouter(prefix="/sunlight", tags=["sunlight"])
_CACHE = {"Cache-Control": "public, max-age=3600"}
# 방향을 이 자리까지 반올림해 같은 요청을 알아본다 (0.006°: 태양 지름의 1%)
_DIRECTION_DECIMALS = 4
_RECENT_MAPS = 8
_RECENT_WINDOWS = 32
# 창 한 변의 타일 수. 클라이언트가 normal 타일을 모아 쓰는 창과 같다 (docs/api.md)
WINDOW_TILES = 4
# 메모리에 펼쳐 두는 5 m 지역 DEM의 수 (하나에 40~140 MB). 창 하나는 겹친 지역 둘까지 걸친다
_OPEN_REGIONS = 2
# 계산 중인 요청 뒤에 줄 설 수 있는 요청 수. 넘으면 429로 돌려보낸다: 기다리는 요청마다
# 서버의 작업 스레드를 하나씩 붙잡아서, 줄이 길어지면 다른 API까지 느려진다
_MAX_WAITING = 4
_RETRY_AFTER_SECONDS = 5


class SunlightBusy(Exception):
    """지도 계산이 밀려 있어 이 요청을 줄에 세우지 않았다."""


class NoSuchWindow(Exception):
    """창으로 나누는 레벨이 아니거나, 창 안에 세밀한 타일이 하나도 없다."""


@dataclass(frozen=True)
class DetailLevel:
    """창으로 나눠 계산하는 레벨: normal 타일 가운데 5 m 지역 DEM이 덮는 곳에만 있는 희소 레벨.

    tile_ranges는 지역마다 타일 범위 (x0, y0, x1, y1), 양 끝 포함.
    """

    grid: SunlightGrid
    tile_px: int
    tile_ranges: tuple[tuple[int, int, int, int], ...]


@dataclass(frozen=True)
class DetailRegion:
    """5 m 지역 DEM 하나: 덮는 범위 (x 최소, y 최소, x 최대, y 최대)와, 필요할 때 여는 방법."""

    bounds_m: tuple[float, float, float, float]
    load: Callable[[], RasterDem]


@dataclass(frozen=True)
class TileWindow:
    """level 레벨의 타일 (tile_x, tile_y)를 왼쪽 위로 하는 WINDOW_TILES x WINDOW_TILES 타일."""

    level: int
    tile_x: int
    tile_y: int


class Renderer(Protocol):
    """방향(과 창) -> PNG 바이트. 창이 없으면 지도 전체."""

    def __call__(self, direction: Direction, window: TileWindow | None = None) -> bytes: ...


# 한 요청이 계산할 격자의 한 변 최대 픽셀 수. 3789(80 m)에 약 3초·0.8 GB이고 넓이에 비례해 는다
_MAX_GRID_PX = 4096


class SunDirection(BaseModel):
    """달에서 태양을 향하는 MOON_ME 방향. 단위 벡터가 아니어도 된다."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float
    y: float
    z: float

    @model_validator(mode="after")
    def check_direction(self) -> Self:
        if math.hypot(self.x, self.y, self.z) == 0.0:
            raise ValueError("the direction must not be a zero vector")
        return self

    def unit(self) -> Direction:
        norm = math.hypot(self.x, self.y, self.z)
        # 반올림이 -0.0을 만들면 같은 방향이 다른 키가 된다
        x, y, z = (round(c / norm, _DIRECTION_DECIMALS) + 0.0 for c in (self.x, self.y, self.z))
        return (x, y, z)


class _Recent:
    """최근 결과 몇 개. 여러 요청 스레드가 함께 쓴다."""

    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._items: OrderedDict[Hashable, bytes] = OrderedDict()
        self._lock = Lock()

    def get(self, key: Hashable) -> bytes | None:
        with self._lock:
            png = self._items.get(key)
            if png is not None:
                self._items.move_to_end(key)
            return png

    def put(self, key: Hashable, png: bytes) -> None:
        with self._lock:
            self._items[key] = png
            while len(self._items) > self._limit:
                self._items.popitem(last=False)


def _grey_png(fraction: NDArray[np.float32]) -> bytes:
    grey = np.round(fraction * 255.0).astype(np.uint8)
    rgba = np.repeat(grey[..., None], 4, axis=2)
    rgba[..., 3] = 255
    return encode_png(rgba)


def make_renderer(
    dem: Dem,
    grid: SunlightGrid,
    *,
    reach_m: float = 200_000.0,
    max_waiting: int = _MAX_WAITING,
    levels: Mapping[int, DetailLevel] | None = None,
    regions: Sequence[DetailRegion] = (),
) -> Renderer:
    """계산은 한 번에 하나만 하고(메모리 약 0.8 GB), 최근 결과를 기억한다.

    기억한 결과는 바로 돌려준다. 새 계산은 계산 중인 요청 뒤에 max_waiting개까지 줄을 서고,
    그보다 많으면 SunlightBusy를 낸다. 지도 전체는 dem과 grid로 계산한다. 창은 levels에 있는
    레벨의 격자로, 창에 걸친 regions를 dem 위에 얹어 계산하고, 없는 창이면 NoSuchWindow를 낸다.
    """
    detail_levels = levels or {}
    maps = _Recent(_RECENT_MAPS)
    windows = _Recent(_RECENT_WINDOWS)
    computing = Lock()
    slots = BoundedSemaphore(1 + max_waiting)

    def window_fraction(direction: Direction, window: TileWindow) -> NDArray[np.float32]:
        level = detail_levels[window.level]
        side = WINDOW_TILES * level.tile_px
        area = GridWindow(window.tile_x * level.tile_px, window.tile_y * level.tile_px, side, side)
        step, center = level.grid.pixel_size_m, level.grid.center_px
        left, top = (area.col - center) * step, (center - area.row) * step
        right, bottom = left + side * step, top - side * step
        over = [
            region.load()
            for region in regions
            if region.bounds_m[0] < right
            and region.bounds_m[2] > left
            and region.bounds_m[1] < top
            and region.bounds_m[3] > bottom
        ]
        heights: HeightField = LayeredHeights([*over, dem]) if over else dem
        return sunlit_fraction(heights, direction, level.grid, window=area, reach_m=reach_m)

    def has_tiles(window: TileWindow) -> bool:
        level = detail_levels.get(window.level)
        return level is not None and any(
            x0 < window.tile_x + WINDOW_TILES
            and x1 >= window.tile_x
            and y0 < window.tile_y + WINDOW_TILES
            and y1 >= window.tile_y
            for x0, y0, x1, y1 in level.tile_ranges
        )

    def renderer(direction: Direction, window: TileWindow | None = None) -> bytes:
        if window is not None and not has_tiles(window):
            raise NoSuchWindow
        recent, key = (maps, direction) if window is None else (windows, (direction, window))
        png = recent.get(key)
        if png is not None:
            return png
        if not slots.acquire(blocking=False):
            raise SunlightBusy
        try:
            with computing:
                # 같은 것을 기다리던 요청은 앞선 계산의 결과를 받는다
                png = recent.get(key)
                if png is None:
                    if window is None:
                        fraction = sunlit_fraction(dem, direction, grid, reach_m=reach_m)
                    else:
                        fraction = window_fraction(direction, window)
                    png = _grey_png(fraction)
                    recent.put(key, png)
                return png
        finally:
            slots.release()

    return renderer


def sunlight_grid(levels: Sequence[Mapping[str, object]]) -> SunlightGrid:
    """normal 타일의 레벨 가운데, 영역 전체를 덮는 가장 세밀한 것의 격자.

    `tile_ranges`가 있는 희소 레벨(지역 몇 곳만 덮는 20 m·5 m)과, 한 요청에 계산하기에
    너무 큰 레벨(_MAX_GRID_PX 초과)은 건너뛴다.
    """
    grids = [
        SunlightGrid(float(str(level["pixel_size_m"])), int(str(level["center_px"])))
        for level in levels
        if "tile_ranges" not in level
    ]
    return min(
        (grid for grid in grids if grid.size_px <= _MAX_GRID_PX),
        key=lambda grid: grid.pixel_size_m,
    )


class _MetaLevel(BaseModel):
    z: int
    pixel_size_m: float
    center_px: int
    tile_px: int
    tile_ranges: tuple[tuple[int, int, int, int], ...] | None = None


def detail_levels(levels: Sequence[Mapping[str, object]]) -> dict[int, DetailLevel]:
    """normal 타일의 레벨 가운데 창으로 나눠 계산할 희소 레벨(`tile_ranges` 있음). 키는 z."""
    found: dict[int, DetailLevel] = {}
    for level in map(_MetaLevel.model_validate, levels):
        if level.tile_ranges is not None:
            found[level.z] = DetailLevel(
                grid=SunlightGrid(level.pixel_size_m, level.center_px),
                tile_px=level.tile_px,
                tile_ranges=level.tile_ranges,
            )
    return found


@lru_cache(maxsize=_OPEN_REGIONS)
def _open_region(path: Path, radius_m: float) -> RasterDem:
    return open_detail_dem(path, radius_m)


@lru_cache(maxsize=2)
def _build_renderer(data_dir: Path) -> Renderer:
    """격자는 sunlight_grid가 고른 normal 타일 레벨과 같다. DEM이나 타일이 없으면 503."""
    meta = data_dir / "tiles" / "normal" / "meta.json"
    try:
        dem = open_dem(resolve_dems(SearchConfig(), data_dir).pairs)
        levels = json.loads(meta.read_text(encoding="utf-8"))["levels"]
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=503,
            detail="NASA data or overlay tiles not found; run the fetch and overlay_tiles "
            "pipelines",
        ) from error
    regions = [
        DetailRegion(read_geotiff_bounds(path), partial(_open_region, path, dem.radius_m))
        for path in detail_dem_paths(data_dir)
    ]
    return make_renderer(dem, sunlight_grid(levels), levels=detail_levels(levels), regions=regions)


def get_renderer(settings: Annotated[Settings, Depends(get_settings)]) -> Renderer:
    return _build_renderer(settings.data_dir)


def _respond(render: Renderer, sun: SunDirection, window: TileWindow | None) -> Response:
    try:
        png = render(sun.unit(), window)
    except NoSuchWindow as error:
        raise HTTPException(status_code=404, detail="no detail tiles in this window") from error
    except SunlightBusy as error:
        raise HTTPException(
            status_code=429,
            detail="Sunlight map busy; retry shortly",
            headers={"Retry-After": str(_RETRY_AFTER_SECONDS)},
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return Response(content=png, media_type="image/png", headers=_CACHE)


@router.get("/south-pole.png")
def south_pole(
    sun: Annotated[SunDirection, Query()],
    render: Annotated[Renderer, Depends(get_renderer)],
) -> Response:
    return _respond(render, sun, None)


@router.get("/south-pole/{level}/{tile_x}/{tile_y}.png")
def south_pole_window(
    level: int,
    tile_x: int,
    tile_y: int,
    sun: Annotated[SunDirection, Query()],
    render: Annotated[Renderer, Depends(get_renderer)],
) -> Response:
    return _respond(render, sun, TileWindow(level, tile_x, tile_y))
