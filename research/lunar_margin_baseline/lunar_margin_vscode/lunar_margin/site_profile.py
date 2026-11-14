"""Build combined terrain, solar, Earth-access, and optional RF site profiles."""

from __future__ import annotations

from .geometry import target_geometry
from .visibility import visibility_from_horizon
from .rf_link import RFConfig, link_budget


def evaluate_time_step(
    utc: str,
    site_name: str,
    lat_deg: float,
    lon_deg: float,
    horizon,
    rf_config: RFConfig | None = None,
) -> dict:
    earth = target_geometry(utc, lat_deg, lon_deg, "EARTH")
    sun = target_geometry(utc, lat_deg, lon_deg, "SUN")

    earth_vis = visibility_from_horizon(earth["az_deg"], earth["el_deg"], horizon)
    sun_vis = visibility_from_horizon(sun["az_deg"], sun["el_deg"], horizon)

    result = {
        "time_utc": utc,
        "site": site_name,
        "earth_az_deg": earth["az_deg"],
        "earth_el_deg": earth["el_deg"],
        "earth_range_km": earth["range_km"],
        "earth_horizon_deg": earth_vis["terrain_horizon_deg"],
        "earth_clearance_deg": earth_vis["clearance_deg"],
        "earth_visible": earth_vis["visible"],
        "sun_az_deg": sun["az_deg"],
        "sun_el_deg": sun["el_deg"],
        "sun_horizon_deg": sun_vis["terrain_horizon_deg"],
        "sun_clearance_deg": sun_vis["clearance_deg"],
        "sun_visible": sun_vis["visible"],
    }

    if rf_config is not None:
        result.update(link_budget(earth["range_km"], earth_vis["visible"], rf_config))

    return result
