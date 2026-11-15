"""GET /sunlight/south-pole.png?x=&y=&z=: 태양 방향 하나에 대한 남극 햇빛 지도 (계약: docs/api.md).

지형 그림자는 태양 방향마다 달라서 미리 구워 둘 수 없다. 요청이 오면 DEM으로 계산하고
(85°S 이남 80 m 격자에 약 3초), 최근 결과 몇 개만 메모리에 둔다.
"""

import json
import math
from collections import OrderedDict
from collections.abc import Callable, Mapping, Sequence
from functools import lru_cache
from pathlib import Path
from threading import BoundedSemaphore, Lock
from typing import Annotated, Self

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, model_validator

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.engine.candidates.field import open_dem
from lunar_margin.engine.dem import Dem
from lunar_margin.engine.sunlight import SunlightGrid, sunlit_fraction
from lunar_margin.pipeline.horizons import resolve_dems
from lunar_margin.pipeline.png import encode_png

Direction = tuple[float, float, float]
Renderer = Callable[[Direction], bytes]

router = APIRouter(prefix="/sunlight", tags=["sunlight"])
_CACHE = {"Cache-Control": "public, max-age=3600"}
# 방향을 이 자리까지 반올림해 같은 요청을 알아본다 (0.006°: 태양 지름의 1%)
_DIRECTION_DECIMALS = 4
_RECENT_MAPS = 8
# 계산 중인 요청 뒤에 줄 설 수 있는 요청 수. 넘으면 429로 돌려보낸다: 기다리는 요청마다
# 서버의 작업 스레드를 하나씩 붙잡아서, 줄이 길어지면 다른 API까지 느려진다
_MAX_WAITING = 4
_RETRY_AFTER_SECONDS = 5


class SunlightBusy(Exception):
    """지도 계산이 밀려 있어 이 요청을 줄에 세우지 않았다."""


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


def make_renderer(
    dem: Dem,
    grid: SunlightGrid,
    *,
    reach_m: float = 200_000.0,
    max_waiting: int = _MAX_WAITING,
) -> Renderer:
    """방향 -> PNG 바이트. 계산은 한 번에 하나만 하고(메모리 약 0.8 GB), 최근 결과를 기억한다.

    기억한 방향은 바로 돌려준다. 새 방향은 계산 중인 요청 뒤에 max_waiting개까지 줄을 서고,
    그보다 많으면 SunlightBusy를 낸다.
    """
    recent: OrderedDict[Direction, bytes] = OrderedDict()
    recent_lock = Lock()
    computing = Lock()
    slots = BoundedSemaphore(1 + max_waiting)

    def remembered(direction: Direction) -> bytes | None:
        with recent_lock:
            png = recent.get(direction)
            if png is not None:
                recent.move_to_end(direction)
            return png

    def renderer(direction: Direction) -> bytes:
        png = remembered(direction)
        if png is not None:
            return png
        if not slots.acquire(blocking=False):
            raise SunlightBusy
        try:
            with computing:
                # 같은 방향을 기다리던 요청은 앞선 계산의 결과를 받는다
                png = remembered(direction)
                if png is None:
                    fraction = sunlit_fraction(dem, direction, grid, reach_m=reach_m)
                    grey = np.round(fraction * 255.0).astype(np.uint8)
                    rgba = np.repeat(grey[..., None], 4, axis=2)
                    rgba[..., 3] = 255
                    png = encode_png(rgba)
                    with recent_lock:
                        recent[direction] = png
                        while len(recent) > _RECENT_MAPS:
                            recent.popitem(last=False)
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


@lru_cache(maxsize=2)
def _build_renderer(data_dir: Path) -> Renderer:
    """격자는 sunlight_grid가 고른 normal 타일 레벨과 같다. DEM이나 타일이 없으면 503."""
    meta = data_dir / "tiles" / "normal" / "meta.json"
    try:
        dem = open_dem(resolve_dems(SearchConfig(), data_dir).pairs)
        grid = sunlight_grid(json.loads(meta.read_text(encoding="utf-8"))["levels"])
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=503,
            detail="NASA data or overlay tiles not found; run the fetch and overlay_tiles "
            "pipelines",
        ) from error
    return make_renderer(dem, grid)


def get_renderer(settings: Annotated[Settings, Depends(get_settings)]) -> Renderer:
    return _build_renderer(settings.data_dir)


@router.get("/south-pole.png")
def south_pole(
    sun: Annotated[SunDirection, Query()],
    render: Annotated[Renderer, Depends(get_renderer)],
) -> Response:
    try:
        png = render(sun.unit())
    except SunlightBusy as error:
        raise HTTPException(
            status_code=429,
            detail="Sunlight map busy; retry shortly",
            headers={"Retry-After": str(_RETRY_AFTER_SECONDS)},
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return Response(content=png, media_type="image/png", headers=_CACHE)
