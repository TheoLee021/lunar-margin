"""SPICE-based Sun/Earth geometry for a lunar surface site."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np
import spiceypy as spice

from .config import MOON_FRAME, MOON_RADIUS_KM


def load_kernels(kernel_paths: Iterable[str | Path]) -> None:
    """Load NAIF kernels into the SPICE kernel pool."""
    for kernel in kernel_paths:
        spice.furnsh(str(kernel))


def site_xyz(lat_deg: float, lon_deg: float, radius_km: float = MOON_RADIUS_KM) -> np.ndarray:
    """Approximate lunar surface site Cartesian position in a Moon-fixed frame."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    return radius_km * np.array(
        [
            np.cos(lat) * np.cos(lon),
            np.cos(lat) * np.sin(lon),
            np.sin(lat),
        ],
        dtype=float,
    )


def local_basis(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return local east, north, up unit vectors in Moon-fixed Cartesian axes."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)

    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array(
        [
            -np.sin(lat) * np.cos(lon),
            -np.sin(lat) * np.sin(lon),
            np.cos(lat),
        ]
    )
    up = np.array(
        [
            np.cos(lat) * np.cos(lon),
            np.cos(lat) * np.sin(lon),
            np.sin(lat),
        ]
    )
    return east, north, up


def vector_to_azel(v_site_to_target: np.ndarray, lat_deg: float, lon_deg: float) -> tuple[float, float]:
    """Convert a site-to-target vector into azimuth/elevation.

    Azimuth convention: 0 deg = north, 90 deg = east.
    """
    east, north, up = local_basis(lat_deg, lon_deg)

    e = float(np.dot(v_site_to_target, east))
    n = float(np.dot(v_site_to_target, north))
    u = float(np.dot(v_site_to_target, up))

    az_deg = float(np.degrees(np.arctan2(e, n)) % 360.0)
    el_deg = float(np.degrees(np.arctan2(u, np.hypot(e, n))))
    return az_deg, el_deg


def target_geometry(
    utc: str,
    lat_deg: float,
    lon_deg: float,
    target: str,
    frame: str = MOON_FRAME,
    aberration: str = "LT+S",
) -> dict:
    """Return target azimuth, elevation, and range from a lunar surface site.

    Parameters
    ----------
    utc:
        UTC string accepted by SPICE, e.g. "2028-11-15T12:00:00".
    target:
        Usually "SUN" or "EARTH".
    frame:
        Moon-fixed frame. MOON_ME is the baseline used by this package.
    """
    et = spice.str2et(utc)

    # Vector from Moon center to target, expressed in Moon-fixed frame.
    r_target_km, _ = spice.spkpos(target, et, frame, aberration, "MOON")
    r_site_km = site_xyz(lat_deg, lon_deg)

    # Vector from lunar surface site to target.
    v_km = np.asarray(r_target_km, dtype=float) - r_site_km
    range_km = float(np.linalg.norm(v_km))
    az_deg, el_deg = vector_to_azel(v_km, lat_deg, lon_deg)

    return {
        "time_utc": utc,
        "target": target.upper(),
        "az_deg": az_deg,
        "el_deg": el_deg,
        "range_km": range_km,
    }
