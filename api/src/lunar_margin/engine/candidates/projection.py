"""달 남극 입체투영 (극에서 축척 1, 단위 m). LOLA 극 DEM과 같은 규약.

x = rho*sin(경도), y = rho*cos(경도), rho = 2R*tan((90°+위도)/2)
따라서 경도 0°가 +y, 동경 90°가 +x 방향이다.
"""

import math

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.ephemeris import MOON_RADIUS_M


def polar_radius_m(lat_deg: float, radius_m: float = MOON_RADIUS_M) -> float:
    """위도 lat_deg(남쪽 음수)인 점의 극으로부터 투영 거리(m)."""
    return 2.0 * radius_m * math.tan(math.radians(90.0 + lat_deg) / 2.0)


def lonlat_to_polar_xy(
    lat_deg: NDArray[np.float64],
    lon_deg: NDArray[np.float64],
    radius_m: float = MOON_RADIUS_M,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    rho = 2.0 * radius_m * np.tan(np.radians(90.0 + lat_deg) / 2.0)
    lon = np.radians(lon_deg)
    return rho * np.sin(lon), rho * np.cos(lon)


def polar_xy_to_lonlat(
    x_m: NDArray[np.float64],
    y_m: NDArray[np.float64],
    radius_m: float = MOON_RADIUS_M,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """(위도°, 경도°). 경도는 [0, 360). 극(0, 0)의 경도는 0으로 정한다."""
    rho = np.hypot(x_m, y_m)
    lat = -90.0 + np.degrees(2.0 * np.arctan(rho / (2.0 * radius_m)))
    lon = np.degrees(np.arctan2(x_m, y_m)) % 360.0
    return lat, lon
