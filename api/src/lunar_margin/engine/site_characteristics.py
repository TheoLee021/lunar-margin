"""Local terrain descriptors for a candidate lunar landing site.

These descriptors deliberately stay close to what the DEM can support:
- elevation at the selected site
- local slope estimated from the DEM gradient
- local roughness as RMS residual elevation after removing a best-fit plane

Slope and roughness are scale-dependent, so the sampling baseline/window are
explicit inputs and returned with the result.
"""

from dataclasses import dataclass

import numpy as np

from lunar_margin.engine.dem import PolarDem


@dataclass(frozen=True)
class SiteCharacteristics:
    elevation_m: float
    slope_deg: float
    roughness_rms_m: float
    slope_baseline_m: float
    roughness_window_m: float


def _xy_at_site(dem: PolarDem, lat_deg: float, lon_deg: float) -> tuple[float, float]:
    if not dem.contains(lat_deg, lon_deg):
        raise ValueError(f"({lat_deg}, {lon_deg}) is outside the DEM or on a missing pixel")
    return dem.lonlat_to_xy(lat_deg, lon_deg)


def local_slope_deg(
    dem: PolarDem,
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
    dem: PolarDem,
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
    dem: PolarDem,
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
