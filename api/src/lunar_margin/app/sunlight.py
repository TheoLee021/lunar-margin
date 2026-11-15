"""GET /sunlight/south-pole.png?x=&y=&z=: 태양 방향 하나에 대한 남극 햇빛 지도 (계약: docs/api.md).

지형 그림자는 태양 방향마다 달라서 미리 구워 둘 수 없다. 요청이 오면 DEM으로 계산하고
(85°S 이남 80 m 격자에 약 3초), 최근 결과 몇 개만 메모리에 둔다.
"""

import json
import math
from collections.abc import Callable, Mapping, Sequence
from functools import lru_cache
from pathlib import Path
from threading import Lock
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


def make_renderer(dem: Dem, grid: SunlightGrid, *, reach_m: float = 200_000.0) -> Renderer:
    """방향 -> PNG 바이트. 계산은 한 번에 하나만 하고(메모리 약 0.8 GB), 최근 결과를 기억한다."""
    lock = Lock()

    @lru_cache(maxsize=_RECENT_MAPS)
    def render(direction: Direction) -> bytes:
        grey = np.round(sunlit_fraction(dem, direction, grid, reach_m=reach_m) * 255.0)
        rgba = np.repeat(grey.astype(np.uint8)[..., None], 4, axis=2)
        rgba[..., 3] = 255
        return encode_png(rgba)

    def renderer(direction: Direction) -> bytes:
        with lock:  # 같은 방향을 기다리던 요청은 계산이 끝난 뒤 기억된 결과를 받는다
            return render(direction)

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
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return Response(content=png, media_type="image/png", headers=_CACHE)
