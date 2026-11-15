"""Terrain access and azimuth-resolved lunar horizon computation."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Iterable

import numpy as np
import rasterio
from pyproj import CRS, Geod, Transformer

from .config import DEFAULT_DEM_URL, MOON_RADIUS_M


@dataclass
class HorizonProfile:
    az_deg: np.ndarray
    horizon_el_deg: np.ndarray

    def at(self, azimuth_deg: float) -> float:
        """Circularly interpolate terrain horizon elevation at an azimuth."""
        az = float(azimuth_deg) % 360.0
        x = np.r_[self.az_deg, self.az_deg[0] + 360.0]
        y = np.r_[self.horizon_el_deg, self.horizon_el_deg[0]]
        return float(np.interp(az, x, y))


class TerrainModel:
    """Read lunar DEM samples and build a local 360-degree horizon profile."""

    def __init__(self, dem_path: str = DEFAULT_DEM_URL):
        self.dem_path = dem_path
        self.dataset = rasterio.open(dem_path)

        moon_geo = CRS.from_proj4(f"+proj=longlat +R={MOON_RADIUS_M} +no_defs")
        self.to_dem = Transformer.from_crs(moon_geo, self.dataset.crs, always_xy=True)

        # Spherical Moon geodesic for advancing along a surface bearing.
        self.geod = Geod(a=MOON_RADIUS_M, b=MOON_RADIUS_M)

    def close(self) -> None:
        self.dataset.close()

    def __enter__(self) -> "TerrainModel":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    @lru_cache(maxsize=100_000)
    def elevation_m(self, lat_deg: float, lon_deg: float) -> float:
        """Sample DEM elevation at latitude/longitude."""
        x, y = self.to_dem.transform(lon_deg, lat_deg)
        value = float(next(self.dataset.sample([(x, y)]))[0])
        nodata = self.dataset.nodata
        if nodata is not None and np.isclose(value, nodata):
            raise ValueError(f"DEM nodata at lat={lat_deg}, lon={lon_deg}")
        return value

    @staticmethod
    def _cartesian(lat_deg: float, lon_deg: float, elevation_m: float) -> np.ndarray:
        lat = np.radians(lat_deg)
        lon = np.radians(lon_deg)
        r = MOON_RADIUS_M + elevation_m
        return r * np.array(
            [
                np.cos(lat) * np.cos(lon),
                np.cos(lat) * np.sin(lon),
                np.sin(lat),
            ]
        )

    def terrain_apparent_elevation_deg(
        self,
        site_lat_deg: float,
        site_lon_deg: float,
        site_elevation_m: float,
        target_lat_deg: float,
        target_lon_deg: float,
        target_elevation_m: float,
        observer_height_m: float = 0.0,
    ) -> float:
        """Apparent elevation angle of a terrain point from the site.

        Cartesian geometry automatically includes lunar curvature.
        """
        r0 = self._cartesian(site_lat_deg, site_lon_deg, site_elevation_m + observer_height_m)
        r1 = self._cartesian(target_lat_deg, target_lon_deg, target_elevation_m)
        v = r1 - r0
        up = r0 / np.linalg.norm(r0)
        sin_el = np.dot(v, up) / np.linalg.norm(v)
        sin_el = np.clip(sin_el, -1.0, 1.0)
        return float(np.degrees(np.arcsin(sin_el)))

    def horizon_profile(
        self,
        site_lat_deg: float,
        site_lon_deg: float,
        az_step_deg: float = 1.0,
        distances_m: Iterable[float] | None = None,
        observer_height_m: float = 0.0,
    ) -> HorizonProfile:
        """Compute the maximum terrain elevation angle for every azimuth.

        The default distance grid is intentionally lightweight for hackathon use.
        Increase density/range for higher fidelity.
        """
        if distances_m is None:
            distances_m = np.unique(
                np.r_[
                    np.arange(100.0, 5_000.0 + 1.0, 100.0),
                    np.arange(5_500.0, 20_000.0 + 1.0, 500.0),
                    np.arange(21_000.0, 100_000.0 + 1.0, 1_000.0),
                ]
            )

        site_h = self.elevation_m(site_lat_deg, site_lon_deg)
        az_values = np.arange(0.0, 360.0, az_step_deg)
        horizon_values = []

        for az in az_values:
            max_el = -90.0
            for distance_m in distances_m:
                lon2, lat2, _ = self.geod.fwd(site_lon_deg, site_lat_deg, az, distance_m)
                try:
                    h2 = self.elevation_m(round(lat2, 8), round(lon2, 8))
                except ValueError:
                    continue

                apparent = self.terrain_apparent_elevation_deg(
                    site_lat_deg,
                    site_lon_deg,
                    site_h,
                    lat2,
                    lon2,
                    h2,
                    observer_height_m=observer_height_m,
                )
                max_el = max(max_el, apparent)

            horizon_values.append(max_el)

        return HorizonProfile(
            az_deg=np.asarray(az_values, dtype=float),
            horizon_el_deg=np.asarray(horizon_values, dtype=float),
        )

    def local_site_characteristics(self, lat_deg: float, lon_deg: float) -> dict:
        """Return baseline site metadata available directly from the DEM.

        Elevation is real DEM data. Slope/roughness are intentionally not inferred
        here unless a dedicated raster layer is supplied, to avoid mixing scales.
        """
        return {
            "lat_deg": float(lat_deg),
            "lon_deg": float(lon_deg),
            "elevation_m": self.elevation_m(lat_deg, lon_deg),
            "terrain_pixel_size": tuple(map(float, self.dataset.res)),
            "dem_crs": str(self.dataset.crs),
        }
