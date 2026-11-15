"""Local terrain visibility from 2 m above the selected point on the 80 m LOLA DEM."""

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.dem import PolarDem

RADIUS_M = 5000
CELL_M = 80
HALF_CELLS = RADIUS_M // CELL_M


def local_viewshed(dem: PolarDem, lat: float, lon: float) -> NDArray[np.uint8]:
    cx, cy = dem.lonlat_to_xy(lat, lon)
    eye = dem.height_at(lat, lon) + 2
    axis = np.arange(-HALF_CELLS, HALF_CELLS + 1, dtype=np.float64) * CELL_M
    x, y = np.meshgrid(axis, axis)
    distance = np.hypot(x, y)
    inside = distance <= RADIUS_M
    dx, dy = x[inside], y[inside]
    curvature = distance[inside] ** 2 / (2 * dem.radius_m)
    target = dem.sample_height_m(cx + dx, cy + dy) - curvature
    known = np.isfinite(target)
    visible = known.copy()
    # At most 20 m between probes along each sightline; compare in the observer's tangent plane.
    steps = RADIUS_M // 20
    for i in range(1, steps):
        f = i / steps
        terrain = dem.sample_height_m(cx + dx * f, cy + dy * f) - curvature * f**2
        known &= np.isfinite(terrain)
        visible &= terrain <= eye + f * (target - eye)
    mask = np.zeros(x.shape, dtype=np.uint8)
    mask[inside] = np.where(known, np.where(visible, 2, 1), 0)
    return mask
