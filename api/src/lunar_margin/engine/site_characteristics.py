"""Local terrain descriptors for a candidate lunar landing site.

These descriptors deliberately stay close to what the DEM can support:
- elevation at the selected site
- local slope estimated from the DEM gradient
- local roughness as RMS residual elevation after removing a best-fit plane

Slope and roughness are scale-dependent, so the sampling baseline/window are
explicit inputs and returned with the result.
"""

import math
from dataclasses import dataclass

import numpy as np

from lunar_margin.engine.dem import Dem


@dataclass(frozen=True)
class SiteCharacteristics:
    elevation_m: float
    slope_deg: float
    roughness_rms_m: float
    slope_baseline_m: float
    roughness_window_m: float


def _xy_at_site(dem: Dem, lat_deg: float, lon_deg: float) -> tuple[float, float]:
    dem.height_at(lat_deg, lon_deg)  # Validate coverage before sampling the footprint.
    rho = 2.0 * dem.radius_m * math.tan(math.radians(90.0 + lat_deg) / 2.0)
    lon = math.radians(lon_deg)
    return rho * math.sin(lon), rho * math.cos(lon)


def local_slope_deg(
    dem: Dem,
    lat_deg: float,
    lon_deg: float,
    *,
    baseline_m: float | None = None,
) -> float:
    """Estimate local slope magnitude from centered finite differences.

    The default baseline is one DEM pixel. A larger baseline smooths small-scale
    terrain and therefore answers a different engineering question.
    """
    x0, y0 = _xy_at_site(dem, lat_deg, lon_deg)
    baseline = dem.label.map_scale_m if baseline_m is None else baseline_m
    if baseline <= 0.0:
        raise ValueError("baseline_m must be positive")

    half = baseline / 2.0
    xs = np.array([x0 - half, x0 + half, x0, x0], dtype=np.float64)
    ys = np.array([y0, y0, y0 - half, y0 + half], dtype=np.float64)
    heights = dem.sample_height_m(xs, ys)
    if np.isnan(heights).any():
        raise ValueError("slope sampling window extends outside the DEM or over missing pixels")

    dz_dx = (heights[1] - heights[0]) / baseline
    dz_dy = (heights[3] - heights[2]) / baseline
    return float(np.degrees(np.arctan(np.hypot(dz_dx, dz_dy))))


def local_roughness_rms_m(
    dem: Dem,
    lat_deg: float,
    lon_deg: float,
    *,
    window_m: float = 100.0,
    samples_per_axis: int = 5,
) -> float:
    """RMS terrain residual after removing a best-fit local plane.

    This is a transparent local roughness proxy, not a claim to reproduce any
    specific published LOLA/QuickMap roughness product. The spatial window is
    part of the metric and must be shown with the value.
    """
    x0, y0 = _xy_at_site(dem, lat_deg, lon_deg)
    if window_m <= 0.0:
        raise ValueError("window_m must be positive")
    if samples_per_axis < 3:
        raise ValueError("samples_per_axis must be at least 3")

    offsets = np.linspace(-window_m / 2.0, window_m / 2.0, samples_per_axis)
    dx, dy = np.meshgrid(offsets, offsets)
    x = x0 + dx.ravel()
    y = y0 + dy.ravel()
    z = dem.sample_height_m(x, y)
    if np.isnan(z).any():
        raise ValueError("roughness sampling window extends outside the DEM or over missing pixels")

    design = np.column_stack((x - x0, y - y0, np.ones_like(x)))
    coefficients, _, _, _ = np.linalg.lstsq(design, z, rcond=None)
    residual = z - design @ coefficients
    return float(np.sqrt(np.mean(residual**2)))


def characterize_site(
    dem: Dem,
    lat_deg: float,
    lon_deg: float,
    *,
    slope_baseline_m: float | None = None,
    roughness_window_m: float = 100.0,
    roughness_samples_per_axis: int = 5,
) -> SiteCharacteristics:
    """Return basic DEM-derived terrain characteristics for one site."""
    slope_baseline = dem.label.map_scale_m if slope_baseline_m is None else slope_baseline_m
    return SiteCharacteristics(
        elevation_m=dem.height_at(lat_deg, lon_deg),
        slope_deg=local_slope_deg(dem, lat_deg, lon_deg, baseline_m=slope_baseline),
        roughness_rms_m=local_roughness_rms_m(
            dem,
            lat_deg,
            lon_deg,
            window_m=roughness_window_m,
            samples_per_axis=roughness_samples_per_axis,
        ),
        slope_baseline_m=float(slope_baseline),
        roughness_window_m=float(roughness_window_m),
    )


@dataclass(frozen=True)
class RegionalTerrain:
    """Coarse DEM-scale statistics within a circular candidate assessment area."""

    radius_m: float
    sample_step_m: float
    total_samples: int
    valid_samples: int
    coverage_fraction: float
    slope_p95_deg: float | None
    slope_max_deg: float | None
    roughness_p95_m: float | None


def characterize_region(
    dem: Dem,
    lat_deg: float,
    lon_deg: float,
    *,
    radius_m: float = 250.0,
    slope_baseline_m: float = 160.0,
    roughness_window_m: float = 400.0,
) -> RegionalTerrain:
    """Sample a circular region on the DEM pixel grid, not a square bounding box.

    The DEM grid spacing is not independent sensor resolution. Each slope is a
    centered difference at the stated baseline, and roughness is the RMS
    residual from a plane fitted over the stated window. Missing cells are
    excluded from statistics and lower the coverage fraction. In particular,
    low coverage must never be interpreted as a PASS.
    """
    if radius_m <= 0 or slope_baseline_m <= 0 or roughness_window_m <= 0:
        raise ValueError("radius, slope baseline and roughness window must be positive")
    x0, y0 = _xy_at_site(dem, lat_deg, lon_deg)
    step = float(dem.label.map_scale_m)
    steps = int(np.floor(radius_m / step))
    offsets = np.arange(-steps, steps + 1, dtype=np.float64) * step
    dx, dy = np.meshgrid(offsets, offsets)
    in_circle = dx**2 + dy**2 <= radius_m**2 + 1e-9
    xs = x0 + dx[in_circle]
    ys = y0 + dy[in_circle]
    n = int(xs.size)

    half = slope_baseline_m / 2.0
    sample_x = np.concatenate((xs - half, xs + half, xs, xs))
    sample_y = np.concatenate((ys, ys, ys - half, ys + half))
    h = dem.sample_height_m(sample_x, sample_y).reshape(4, n)
    valid = np.isfinite(h).all(axis=0)
    grades = np.degrees(
        np.arctan(np.hypot((h[1] - h[0]) / slope_baseline_m, (h[3] - h[2]) / slope_baseline_m))
    )

    # Independently evaluate roughness at every candidate sample. Do not
    # replace an invalid footprint/window with a zero-roughness estimate.
    window_offsets = np.linspace(-roughness_window_m / 2, roughness_window_m / 2, 5)
    wx, wy = np.meshgrid(window_offsets, window_offsets)
    wx, wy = wx.ravel(), wy.ravel()
    design = np.column_stack((wx, wy, np.ones_like(wx)))
    z = dem.sample_height_m((xs[:, None] + wx).ravel(), (ys[:, None] + wy).ravel())
    z = z.reshape(n, wx.size)
    valid &= np.isfinite(z).all(axis=1)
    # Every window shares the same offsets, so one pseudo-inverse fits all planes at once.
    residual = z - (z @ np.linalg.pinv(design).T) @ design.T
    roughness = np.sqrt(np.mean(residual**2, axis=1))

    count = int(np.count_nonzero(valid))
    return RegionalTerrain(
        radius_m=float(radius_m),
        sample_step_m=step,
        total_samples=n,
        valid_samples=count,
        coverage_fraction=count / n,
        slope_p95_deg=float(np.percentile(grades[valid], 95)) if count else None,
        slope_max_deg=float(np.max(grades[valid])) if count else None,
        roughness_p95_m=float(np.percentile(roughness[valid], 95)) if count else None,
    )
