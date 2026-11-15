"""Additional geometric access and optional *nominal* DTE RF diagnostics.

Keeps the primary Sun/Earth LOS and ranking physics unchanged. RF values require
an explicitly supplied hardware/ground-station scenario; they are NOT a
validated communication link or a mission-success probability.
"""

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.ephemeris import MOON_RADIUS_M
from lunar_margin.engine.horizon import HorizonProfile
from lunar_margin.engine.metrics import find_runs

C_MPS = 299_792_458.0


@dataclass(frozen=True)
class AccessDiagnostics:
    longest_visible_hours: float
    transitions: int
    clearance_p10_deg: float | None


@dataclass(frozen=True)
class RFConfig:
    frequency_hz: float
    tx_power_w: float
    tx_gain_dbi: float
    rx_gain_dbi: float
    misc_loss_db: float
    rx_required_dbm: float
    target_margin_db: float


@dataclass(frozen=True)
class RFDiagnostics:
    available_fraction: float
    longest_unavailable_hours: float
    min_visible_margin_db: float | None


def access_diagnostics(
    horizon: HorizonProfile,
    azimuth_deg: NDArray[np.float64],
    elevation_deg: NDArray[np.float64],
    visible: NDArray[np.bool_],
    step_minutes: int,
) -> AccessDiagnostics:
    """Describe how robust/continuous an already-computed geometric LOS is.

    The percentile is taken over positive center-of-disk clearances only.
    Its value measures geometric separation, NOT a quantified confidence bound.
    """
    if step_minutes <= 0 or visible.size == 0:
        raise ValueError("nonempty visibility and positive step_minutes required")
    if visible.shape != azimuth_deg.shape or visible.shape != elevation_deg.shape:
        raise ValueError("azimuth, elevation and visibility must have equal shape")
    clearance = elevation_deg - horizon.at(azimuth_deg)
    values = clearance[visible]
    if not np.isfinite(clearance).all():
        raise ValueError("non-finite terrain clearance")
    runs = find_runs(visible, True)
    longest = max((b - a for a, b in runs), default=0) * step_minutes / 60.0
    transitions = int(np.count_nonzero(visible[1:] != visible[:-1]))
    return AccessDiagnostics(
        longest_visible_hours=float(longest),
        transitions=transitions,
        clearance_p10_deg=float(np.percentile(values, 10)) if values.size else None,
    )


def target_range_km(
    vectors_km: NDArray[np.float64],
    lat_deg: float,
    lon_deg: float,
    observer_height_m: float = 0.0,
) -> NDArray[np.float64]:
    """Site-to-target range using the same spherical MOON_ME position as az/el."""
    if vectors_km.ndim != 2 or vectors_km.shape[1] != 3:
        raise ValueError("target vectors must be an (N, 3) array")
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    up = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    site_km = up * ((MOON_RADIUS_M + observer_height_m) / 1000.0)
    return np.linalg.norm(vectors_km - site_km, axis=1)


def nominal_rf_diagnostics(
    distances_km: NDArray[np.float64],
    geometric_visible: NDArray[np.bool_],
    step_minutes: int,
    config: RFConfig,
) -> RFDiagnostics:
    """Free-space link-budget diagnostic ported from the team's baseline.

    LOS is an independent gate; no antenna pattern, pointing, Earth station
    schedule, receiver noise/data rate, weather or coding model is included.
    """
    if distances_km.shape != geometric_visible.shape or distances_km.size == 0:
        raise ValueError("distance and LOS arrays must have the same nonempty shape")
    if not np.isfinite(distances_km).all() or np.any(distances_km <= 0):
        raise ValueError("all ranges must be finite and positive")
    if step_minutes <= 0 or config.frequency_hz <= 0 or config.tx_power_w <= 0:
        raise ValueError("invalid RF configuration or sample interval")
    fspl_db = 20.0 * np.log10(4.0 * math.pi * distances_km * 1000.0 * config.frequency_hz / C_MPS)
    tx_dbm = 10.0 * math.log10(config.tx_power_w) + 30.0
    rx_dbm = tx_dbm + config.tx_gain_dbi + config.rx_gain_dbi - fspl_db - config.misc_loss_db
    margins = rx_dbm - config.rx_required_dbm
    usable = geometric_visible & (margins >= config.target_margin_db)
    blocked_runs = find_runs(usable, False)
    longest_blocked = max((b - a for a, b in blocked_runs), default=0)
    visible_margins = margins[geometric_visible]
    return RFDiagnostics(
        available_fraction=float(usable.mean()),
        longest_unavailable_hours=float(longest_blocked * step_minutes / 60.0),
        min_visible_margin_db=(float(np.min(visible_margins)) if visible_margins.size else None),
    )
