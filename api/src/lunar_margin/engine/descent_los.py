"""Moon-fixed geometric line of sight for an airborne lander.

This evaluates geometric obstruction only, not RF link margin, antenna
pointing, or availability of a mission-specific orbiter relay.
"""

import math
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.descent_reference import R_M, Terrain

Vec = NDArray[np.float64]
LosStatus = Literal["VISIBLE", "BLOCKED", "UNKNOWN"]


def terrain_los(
    dem: Terrain,
    observer_m: Vec,
    target_m: Vec,
    *,
    sample_m: float = 80.0,
    max_range_m: float = 400_000.0,
) -> LosStatus:
    """Determine whether Moon/DEM terrain obstructs a straight ray.

    A distant ray is called visible after it has reached 12 km above the
    reference sphere and is moving radially outward. This is a conservative
    heuristic for the dataset, not a proof for unobserved topographic extremes.
    """
    if observer_m.shape != (3,) or target_m.shape != (3,):
        raise ValueError("positions must be 3-vectors in Moon-fixed metres")
    if not (0 < sample_m <= 1000) or not (0 < max_range_m <= 1_000_000):
        raise ValueError("invalid LOS sampling settings")
    if not np.isfinite(observer_m).all() or not np.isfinite(target_m).all():
        raise ValueError("LOS positions must be finite")
    difference = target_m - observer_m
    distance = float(np.linalg.norm(difference))
    if distance < 1.0:
        raise ValueError("LOS target is too close")
    direction = difference / distance

    closest = min(distance, max(0.0, -float(np.dot(observer_m, direction))))
    if float(np.linalg.norm(observer_m + closest * direction)) < R_M - 0.001:
        return "BLOCKED"

    end = min(distance, max_range_m)
    count = math.ceil(end / sample_m)
    distances = np.linspace(min(sample_m, end), end, count)
    positions = observer_m[None, :] + distances[:, None] * direction[None, :]
    radii = np.linalg.norm(positions, axis=1)
    altitudes = radii - R_M
    needs_dem = altitudes <= 12_000.0
    if needs_dem.any():
        near = positions[needs_dem]
        near_radii = radii[needs_dem]
        lats = np.degrees(np.arcsin(np.clip(near[:, 2] / near_radii, -1, 1)))
        lons = np.degrees(np.arctan2(near[:, 1], near[:, 0]))
        heights = dem.sample_height_lonlat_m(lats, lons)
        if np.any(np.isfinite(heights) & (near_radii - R_M <= heights)):
            return "BLOCKED"
        if not np.isfinite(heights).all():
            return "UNKNOWN"

    if end >= distance:
        return "VISIBLE"
    last = observer_m + end * direction
    if float(np.linalg.norm(last)) > R_M + 12_000.0 and float(np.dot(last, direction)) >= 0:
        return "VISIBLE"
    return "UNKNOWN"
