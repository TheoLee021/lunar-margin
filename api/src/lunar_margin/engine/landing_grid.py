"""DEM-scale landing target grid inside a coarse lunar candidate site.

A 500 m *discovery spacing* is not a 500 m safe landing pad. For each
selected site, sample a 250 m assessment circle at the DEM pixel spacing,
then evaluate candidate 50 m target circles against slope/roughness proxies.
This is explicitly not touchdown safety certification: subpixel hazards,
footpad support, boulders and landing dispersion are not observable here.
"""

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.candidates.projection import polar_xy_to_lonlat
from lunar_margin.engine.dem import Dem


@dataclass(frozen=True)
class LandingGridCell:
    dx_m: float
    dy_m: float
    slope_deg: float | None
    roughness_rms_m: float | None
    valid: bool
    in_assessment_circle: bool


@dataclass(frozen=True)
class TargetCircle:
    dx_m: float
    dy_m: float
    lat_deg: float
    lon_deg: float
    cells_intersecting: int
    valid_cells: int
    coverage_fraction: float
    slope_p95_deg: float | None
    slope_max_deg: float | None
    roughness_max_m: float | None
    terrain_screen_pass: bool
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class LandingGridResult:
    assessment_radius_m: float
    target_radius_m: float
    sample_step_m: float
    slope_baseline_m: float
    roughness_window_m: float
    max_slope_deg: float
    max_roughness_m: float | None
    total_target_centers: int
    passing_target_centers: int
    cells: tuple[LandingGridCell, ...]
    best_target: TargetCircle | None
    targets: tuple[TargetCircle, ...]
    landing_safety_status: str = "UNVERIFIED"
    limitation: str = (
        "80 m-class DEM-scale screening only; a 50 m target circle is BELOW "
        "the resolved terrain scale. No boulder, footpad or dispersion safety claim."
    )


def _sample_descriptors(
    dem: Dem,
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    slope_baseline_m: float,
    roughness_window_m: float,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Use the same finite-difference/plane-fit proxies as site_characteristics."""
    n = x.size
    half = slope_baseline_m / 2.0
    xs = np.concatenate((x - half, x + half, x, x))
    ys = np.concatenate((y, y, y - half, y + half))
    h = dem.sample_height_m(xs, ys).reshape(4, n)
    slopes = np.degrees(
        np.arctan(
            np.hypot(
                (h[1] - h[0]) / slope_baseline_m,
                (h[3] - h[2]) / slope_baseline_m,
            )
        )
    )
    win = np.linspace(-roughness_window_m / 2.0, roughness_window_m / 2.0, 5)
    wx, wy = np.meshgrid(win, win)
    ox, oy = wx.ravel(), wy.ravel()
    design = np.column_stack((ox, oy, np.ones_like(ox)))
    roughness = np.full(n, np.nan, dtype=np.float64)
    for i in np.flatnonzero(np.isfinite(slopes)):
        z = dem.sample_height_m(x[i] + ox, y[i] + oy)
        if not np.isfinite(z).all():
            continue
        coeff, _, _, _ = np.linalg.lstsq(design, z, rcond=None)
        roughness[i] = float(np.sqrt(np.mean((z - design @ coeff) ** 2)))
    return slopes, roughness


def evaluate_landing_grid(
    dem: Dem,
    lat_deg: float,
    lon_deg: float,
    *,
    assessment_radius_m: float = 250.0,
    target_radius_m: float = 50.0,
    slope_baseline_m: float = 160.0,
    roughness_window_m: float = 400.0,
    max_slope_deg: float = 10.0,
    max_roughness_m: float | None = None,
) -> LandingGridResult:
    """Rank local target circles without ever declaring a landing site safe.

    A node's square support may intersect a target circle even if its center
    is outside that circle. Account for that with half the cell diagonal,
    and fail closed if any intersecting node lacks a complete terrain window.
    Candidate target circles must lie fully inside the assessment radius.
    """
    if not 0 < target_radius_m < assessment_radius_m:
        raise ValueError("target radius must be positive and smaller than assessment radius")
    if slope_baseline_m <= 0 or roughness_window_m <= 0 or not 0 <= max_slope_deg <= 90:
        raise ValueError("invalid slope/roughness parameters")
    if max_roughness_m is not None and max_roughness_m < 0:
        raise ValueError("max_roughness_m must be nonnegative")
    dem.height_at(lat_deg, lon_deg)  # reject a missing/outside center
    step = float(dem.label.map_scale_m)
    if step <= 0:
        raise ValueError("DEM map scale must be positive")
    rho = 2.0 * dem.radius_m * math.tan(math.radians(90.0 + lat_deg) / 2.0)
    lon_rad = math.radians(lon_deg)
    x0, y0 = rho * math.sin(lon_rad), rho * math.cos(lon_rad)
    half_cell_diagonal = step / math.sqrt(2.0)
    # Include cells touching the assessment circle; needed at target edges.
    limit = assessment_radius_m + half_cell_diagonal
    n = math.ceil(limit / step)
    offset = np.arange(-n, n + 1, dtype=np.float64) * step
    gx, gy = np.meshgrid(offset, offset)
    within = (gx * gx + gy * gy) <= limit * limit + 1e-9
    dx, dy = gx[within], gy[within]
    x, y = x0 + dx, y0 + dy
    slopes, roughness = _sample_descriptors(dem, x, y, slope_baseline_m, roughness_window_m)
    valid = np.isfinite(slopes) & np.isfinite(roughness)
    interior = (dx * dx + dy * dy) <= assessment_radius_m**2 + 1e-9
    cells = tuple(
        LandingGridCell(
            dx_m=float(dx[i]),
            dy_m=float(dy[i]),
            slope_deg=float(slopes[i]) if np.isfinite(slopes[i]) else None,
            roughness_rms_m=float(roughness[i]) if np.isfinite(roughness[i]) else None,
            valid=bool(valid[i]),
            in_assessment_circle=bool(interior[i]),
        )
        for i in range(dx.size)
    )
    centers = np.flatnonzero(np.hypot(dx, dy) <= assessment_radius_m - target_radius_m + 1e-9)
    targets: list[TargetCircle] = []
    for k in centers:
        # A 50 m disk can intersect an 80 m cell whose center lies outside it.
        overlap = np.hypot(dx - dx[k], dy - dy[k]) <= target_radius_m + half_cell_diagonal + 1e-9
        total = int(np.count_nonzero(overlap))
        valid_cell = overlap & valid
        count = int(np.count_nonzero(valid_cell))
        complete = count == total and total > 0
        slope_values = slopes[valid_cell]
        rough_values = roughness[valid_cell]
        max_slope = float(np.max(slope_values)) if count else None
        p95_slope = float(np.percentile(slope_values, 95)) if count else None
        max_roughness = float(np.max(rough_values)) if count else None
        reasons: list[str] = []
        if not complete:
            reasons.append("terrain_incomplete")
        if max_slope is not None and max_slope > max_slope_deg:
            reasons.append("terrain_slope_above_max")
        if (
            max_roughness_m is not None
            and max_roughness is not None
            and max_roughness > max_roughness_m
        ):
            reasons.append("terrain_roughness_above_max")
        latitude, longitude = polar_xy_to_lonlat(
            np.array([x[k]], dtype=np.float64),
            np.array([y[k]], dtype=np.float64),
            dem.radius_m,
        )
        targets.append(
            TargetCircle(
                dx_m=float(dx[k]),
                dy_m=float(dy[k]),
                lat_deg=float(latitude[0]),
                lon_deg=float(longitude[0]),
                cells_intersecting=total,
                valid_cells=count,
                coverage_fraction=count / total if total else 0.0,
                slope_p95_deg=p95_slope,
                slope_max_deg=max_slope,
                roughness_max_m=max_roughness,
                terrain_screen_pass=not reasons,
                reasons=tuple(reasons),
            )
        )
    # Best *screened* center by worst-slope first, then roughness, then distance.
    passed = [target for target in targets if target.terrain_screen_pass]
    ordered = sorted(
        targets,
        key=lambda t: (
            not t.terrain_screen_pass,
            float("inf") if t.slope_max_deg is None else t.slope_max_deg,
            float("inf") if t.roughness_max_m is None else t.roughness_max_m,
            math.hypot(t.dx_m, t.dy_m),
            t.dy_m,
            t.dx_m,
        ),
    )
    return LandingGridResult(
        assessment_radius_m=assessment_radius_m,
        target_radius_m=target_radius_m,
        sample_step_m=step,
        slope_baseline_m=slope_baseline_m,
        roughness_window_m=roughness_window_m,
        max_slope_deg=max_slope_deg,
        max_roughness_m=max_roughness_m,
        total_target_centers=len(targets),
        passing_target_centers=len(passed),
        cells=cells,
        targets=tuple(ordered),
        best_target=ordered[0] if passed else None,
    )
