"""Local terrain visibility from an observer above the selected point on the 80 m LOLA DEM."""

import math

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.dem import PolarDem

RADIUS_M = 5000
CELL_M = 80
HALF_CELLS = RADIUS_M // CELL_M


def _trace_cells(
    dem: PolarDem,
    cx: float,
    cy: float,
    eye: float,
    dx: NDArray[np.float64],
    dy: NDArray[np.float64],
) -> tuple[NDArray[np.bool_], NDArray[np.float64], NDArray[np.float64]]:
    """Known paths, first crossing fraction (NaN when clear), and target ground height."""
    scale = dem.label.map_scale_m
    target = dem.sample_height_m(cx + dx, cy + dy)
    curvature = (dx**2 + dy**2) / (2 * dem.radius_m)

    def cuts(pixel: float, delta: NDArray[np.float64]) -> NDArray[np.float64]:
        # Crossings of integer pixel coordinates delimit bilinear interpolation patches.
        count = int(np.ceil(np.max(np.abs(delta)))) + 1
        first = np.where(delta > 0, math.floor(pixel) + 1, math.ceil(pixel) - 1)
        edges = first[:, None] + np.sign(delta[:, None]) * np.arange(count)
        return np.clip((edges - pixel) / np.where(delta == 0, 1, delta)[:, None], 0, 1)

    shape = (len(dx), 1)
    boundaries = np.sort(
        np.concatenate(
            (
                np.zeros(shape),
                cuts(dem.label.sample_offset + cx / scale, dx / scale),
                cuts(dem.label.line_offset - cy / scale, -dy / scale),
                np.ones(shape),
            ),
            axis=1,
        ),
        axis=1,
    )

    def clearance(t: NDArray[np.float64]) -> NDArray[np.float64]:
        ground = dem.sample_height_m(cx + dx[:, None] * t, cy + dy[:, None] * t)
        return eye + t * (target - curvature - eye)[:, None] + t * t * curvature[:, None] - ground

    lo, hi = boundaries[:, :-1], boundaries[:, 1:]
    edge = clearance(boundaries)
    left, right = edge[:, :-1], edge[:, 1:]
    mid = clearance((lo + hi) / 2)
    known = np.isfinite(edge).all(axis=1) & np.isfinite(mid).all(axis=1)
    # Clearance on each patch is exactly quadratic in the local fraction u.
    a = 2 * (left + right - 2 * mid)
    b = right - left - a
    u = np.where(a > 0, np.clip(-b / np.where(a > 0, 2 * a, 1), 0, 1), np.where(left < right, 0, 1))
    blocked = ((a * u + b) * u + left < -1e-7) & (hi > lo)
    rows = np.arange(len(dx))
    j = np.argmax(blocked, axis=1)
    lower = np.zeros(len(dx))
    upper = u[rows, j].copy()
    for _ in range(28):
        probe = (lower + upper) / 2
        below = (a[rows, j] * probe + b[rows, j]) * probe + left[rows, j] <= 0
        upper = np.where(below, probe, upper)
        lower = np.where(below, lower, probe)
    hit = np.where(known & blocked.any(axis=1), lo[rows, j] + upper * (hi - lo)[rows, j], np.nan)
    return known, hit, target


def _observer(
    dem: PolarDem, lat: float, lon: float, height: float, center: tuple[float, float] | None
) -> tuple[float, float, float]:
    x, y = center or dem.lonlat_to_xy(lat, lon)
    ground = float(dem.sample_height_m(np.array([x]), np.array([y]))[0])
    if not math.isfinite(ground):
        raise ValueError("observer outside DEM coverage")
    return x, y, ground + height


def local_viewshed(
    dem: PolarDem,
    lat: float,
    lon: float,
    observer_height_m: float = 2,
    *,
    center: tuple[float, float] | None = None,
) -> NDArray[np.uint8]:
    cx, cy, eye = _observer(dem, lat, lon, observer_height_m, center)
    axis = np.arange(-HALF_CELLS, HALF_CELLS + 1, dtype=np.float64) * CELL_M
    x, y = np.meshgrid(axis, axis)
    distance = np.hypot(x, y)
    inside = distance <= RADIUS_M
    dx, dy = x[inside], y[inside]
    codes = np.zeros(len(dx), dtype=np.uint8)
    for start in range(0, len(dx), 256):
        chunk = slice(start, start + 256)
        known, hit, _ = _trace_cells(dem, cx, cy, eye, dx[chunk], dy[chunk])
        codes[chunk] = np.where(known, np.where(np.isfinite(hit), 1, 2), 0)
    mask = np.zeros(x.shape, dtype=np.uint8)
    mask[inside] = codes
    return mask


def horizontal_rays(
    dem: PolarDem,
    lat: float,
    lon: float,
    observer_height_m: float = 2,
    *,
    center: tuple[float, float] | None = None,
) -> tuple[float, list[tuple[float, bool]]]:
    """Tangent rays, starting at north and turning clockwise in 15 degree steps."""
    _, _, eye = _observer(dem, lat, lon, observer_height_m, center)
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


def _grid_offsets() -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    step = CELL_M * 10
    axis = np.arange(-6, 7, dtype=np.float64) * step
    xx, yy = np.meshgrid(axis, axis)
    distance = np.hypot(xx, yy)
    inside = (distance > 0) & (distance <= RADIUS_M)
    return xx[inside], yy[inside]


def visible_grid_fraction(dem: PolarDem, x: float, y: float, height: float) -> float:
    ground = dem.sample_height_m(np.array([x]), np.array([y]))[0]
    if not np.isfinite(ground):
        return math.nan
    dx, dy = _grid_offsets()
    known, hit, _ = _trace_cells(dem, x, y, float(ground) + height, dx, dy)
    return float(np.count_nonzero(np.isnan(hit)) / len(dx)) if known.all() else math.nan


def grid_sightlines(
    dem: PolarDem,
    lat: float,
    lon: float,
    observer_height_m: float = 2,
    *,
    center: tuple[float, float] | None = None,
) -> list[tuple[tuple[float, float, float], tuple[float, float, float] | None]]:
    """Target and optional first obstruction (lon, lat, height) for the display grid."""
    cx, cy, eye = _observer(dem, lat, lon, observer_height_m, center)
    dx, dy = _grid_offsets()
    curvature = (dx**2 + dy**2) / (2 * dem.radius_m)
    known, hits, heights = _trace_cells(dem, cx, cy, eye, dx, dy)

    def location(x: float, y: float, height: float) -> tuple[float, float, float]:
        return (
            float(np.degrees(np.arctan2(x, y))),
            float(np.degrees(2 * np.arctan(np.hypot(x, y) / (2 * dem.radius_m))) - 90),
            float(height),
        )

    result: list[tuple[tuple[float, float, float], tuple[float, float, float] | None]] = []
    for col in np.flatnonzero(known):
        end = location(cx + dx[col], cy + dy[col], heights[col])
        t = hits[col]
        hit = None
        if np.isfinite(t):
            height = eye + t * (heights[col] - curvature[col] - eye) + t * t * curvature[col]
            hit = location(cx + t * dx[col], cy + t * dy[col], height)
        result.append((end, hit))
    return result
