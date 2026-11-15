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


def horizontal_rays(
    dem: PolarDem, lat: float, lon: float
) -> tuple[float, list[tuple[float, bool]]]:
    """Tangent rays, starting at north and turning clockwise in 15 degree steps."""
    eye = dem.height_at(lat, lon) + 2
    phi, lam = np.radians([lat, lon])
    up = np.array([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)])
    east = np.array([-np.sin(lam), np.cos(lam), 0.0])
    north = np.cross(up, east)
    start = (dem.radius_m + eye) * up
    distances = np.arange(0, RADIUS_M + 1, 5, dtype=np.float64)
    rays: list[tuple[float, bool]] = []
    for bearing in np.radians(np.arange(0, 360, 15)):
        direction = north * np.cos(bearing) + east * np.sin(bearing)
        positions = start + distances[:, None] * direction
        x, y, z = positions.T
        radius = np.hypot(np.hypot(x, y), z)
        heights = dem.sample_height_lonlat_m(
            np.degrees(np.arctan2(z, np.hypot(x, y))), np.degrees(np.arctan2(y, x))
        )
        clearance = radius - dem.radius_m - heights
        stops = np.flatnonzero(~np.isfinite(clearance) | (clearance <= 0))
        if not stops.size:
            rays.append((float(RADIUS_M), False))
            continue
        i = int(stops[0])
        previous = max(0, i - 1)
        if not np.isfinite(clearance[i]) or i == 0:
            rays.append((float(distances[previous]), False))
            continue
        fraction = clearance[previous] / (clearance[previous] - clearance[i])
        rays.append((float(distances[previous] + fraction * 5), True))
    return eye, rays


def grid_sightlines(
    dem: PolarDem, lat: float, lon: float
) -> list[tuple[tuple[float, float, float], tuple[float, float, float] | None]]:
    """Target and optional first obstruction (lon, lat, height) for the display grid."""
    cx, cy = dem.lonlat_to_xy(lat, lon)
    eye = dem.height_at(lat, lon) + 2
    step = CELL_M * 10
    axis = np.arange(-6, 7, dtype=np.float64) * step
    xx, yy = np.meshgrid(axis, axis)
    distance = np.hypot(xx, yy)
    inside = (distance > 0) & (distance <= RADIUS_M)
    dx, dy = xx[inside], yy[inside]
    curvature = distance[inside] ** 2 / (2 * dem.radius_m)
    f = np.linspace(0, 1, RADIUS_M // 20 + 1)[:, None]
    terrain = dem.sample_height_m(cx + f * dx, cy + f * dy)
    sight = eye + f * (terrain[-1] - curvature - eye)
    clearance = sight - (terrain - curvature * f**2)

    def location(x: float, y: float, height: float) -> tuple[float, float, float]:
        return (
            float(np.degrees(np.arctan2(x, y))),
            float(np.degrees(2 * np.arctan(np.hypot(x, y) / (2 * dem.radius_m))) - 90),
            float(height),
        )

    result: list[tuple[tuple[float, float, float], tuple[float, float, float] | None]] = []
    for col in np.flatnonzero(np.all(np.isfinite(clearance), axis=0)):
        end = location(cx + dx[col], cy + dy[col], terrain[-1, col])
        blocked = np.flatnonzero(clearance[1:-1, col] < 0)
        hit = None
        if blocked.size:
            a = int(blocked[0])
            u = clearance[a, col] / (clearance[a, col] - clearance[a + 1, col])
            t = (a + u) / (len(f) - 1)
            height = eye + t * (terrain[-1, col] - curvature[col] - eye) + t * t * curvature[col]
            hit = location(cx + t * dx[col], cy + t * dy[col], height)
        result.append((end, hit))
    return result
