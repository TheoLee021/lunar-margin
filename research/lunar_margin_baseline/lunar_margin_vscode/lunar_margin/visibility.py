"""Terrain-aware Sun/Earth visibility tests."""

from __future__ import annotations

from .terrain import HorizonProfile


def visibility_from_horizon(
    az_deg: float,
    el_deg: float,
    horizon: HorizonProfile,
) -> dict:
    terrain_horizon_deg = horizon.at(az_deg)
    clearance_deg = float(el_deg - terrain_horizon_deg)
    return {
        "terrain_horizon_deg": terrain_horizon_deg,
        "clearance_deg": clearance_deg,
        "visible": bool(clearance_deg > 0.0),
    }
