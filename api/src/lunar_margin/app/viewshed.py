from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from lunar_margin.app.analysis import get_dem
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.viewshed import grid_sightlines, horizontal_rays, local_viewshed

router = APIRouter()


class Viewshed(BaseModel):
    lat: float
    lon: float
    center_x_m: float
    center_y_m: float
    cells: str
    observer_height_m: float
    eye_height_m: float
    targets: list[tuple[tuple[float, float, float], tuple[float, float, float] | None]]
    rays: list[tuple[float, bool]]


@router.get("/analysis/viewshed")
def viewshed(
    lat: Annotated[float, Query(ge=-90, le=-80)],
    lon: Annotated[float, Query(ge=-180, le=360)],
    dem: Annotated[PolarDem, Depends(get_dem)],
    observer_height_m: Annotated[float, Query(ge=0, le=100)] = 2,
    center_x_m: float | None = None,
    center_y_m: float | None = None,
) -> Viewshed:
    cx, cy = dem.lonlat_to_xy(lat, lon)
    if center_x_m is not None or center_y_m is not None:
        if (
            center_x_m is None
            or center_y_m is None
            or not (abs(cx - center_x_m) <= 0.1 and abs(cy - center_y_m) <= 0.1)
        ):
            raise HTTPException(status_code=422, detail="grid center does not match coordinates")
        cx, cy = center_x_m, center_y_m
    try:
        mask = local_viewshed(dem, lat, lon, observer_height_m, center=(cx, cy))
        eye, rays = horizontal_rays(dem, lat, lon, observer_height_m, center=(cx, cy))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    cells = (mask + ord("0")).tobytes().decode("ascii")
    return Viewshed(
        lat=lat,
        lon=lon,
        center_x_m=cx,
        center_y_m=cy,
        cells=cells,
        eye_height_m=eye,
        observer_height_m=observer_height_m,
        rays=rays,
        targets=grid_sightlines(dem, lat, lon, observer_height_m, center=(cx, cy)),
    )
