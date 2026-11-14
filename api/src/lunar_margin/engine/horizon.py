"""관측점에서 본 방위각별 지형 수평선 고각."""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.dem import Dem


@dataclass(frozen=True)
class HorizonProfile:
    azimuth_deg: NDArray[np.float64]  # 0°=북, 시계방향, 오름차순, [0, 360)
    elevation_deg: NDArray[np.float64]
    # 모든 광선이 max_range까지 DEM 안에 머물렀는가. False면 DEM 밖 지형을 알 수 없어
    # 수평선이 실제보다 낮게 계산됐을 수 있다 (값 자체는 DEM 안쪽 구간 기준으로 유효).
    complete: bool = True

    def at(self, azimuth_deg: NDArray[np.float64]) -> NDArray[np.float64]:
        """임의 방위각의 수평선 고각 (360° 주기 선형 보간)."""
        return np.interp(azimuth_deg, self.azimuth_deg, self.elevation_deg, period=360.0)


def horizon_profile(
    dem: Dem,
    lat_deg: float,
    lon_deg: float,
    *,
    observer_height_m: float = 0.0,
    azimuth_step_deg: float = 1.0,
    max_range_m: float = 200_000.0,
    step_m: float | None = None,
) -> HorizonProfile:
    """방위각마다 레이를 따라 지형을 훑어 최대 고각을 구한다.

    고각은 달 곡률을 포함한다: 관측점 반지름 r0, 목표 반지름 r1, 중심각 theta일 때
    tan(el) = (r1*cos(theta) - r0) / (r1*sin(theta)).
    """
    ground_m = dem.height_at(lat_deg, lon_deg)  # DEM 밖이면 ValueError
    radius_m = dem.radius_m
    r0 = radius_m + ground_m + observer_height_m

    step = step_m if step_m is not None else dem.label.map_scale_m
    distance_m = np.arange(step, max_range_m + step / 2, step)
    theta = distance_m / radius_m  # (D,)
    az_deg = np.arange(0.0, 360.0, azimuth_step_deg)
    az = np.radians(az_deg)[:, None]  # (A, 1)

    lat1, lon1 = np.radians(lat_deg), np.radians(lon_deg)
    sin_lat2 = np.sin(lat1) * np.cos(theta) + np.cos(lat1) * np.sin(theta) * np.cos(az)
    lat2 = np.arcsin(np.clip(sin_lat2, -1.0, 1.0))
    lon2 = lon1 + np.arctan2(
        np.sin(az) * np.sin(theta) * np.cos(lat1),
        np.cos(theta) - np.sin(lat1) * sin_lat2,
    )

    heights = dem.sample_height_lonlat_m(np.degrees(lat2).ravel(), np.degrees(lon2).ravel())
    heights = heights.reshape(lat2.shape)
    r1 = radius_m + heights
    elevation = np.arctan2(r1 * np.cos(theta) - r0, r1 * np.sin(theta))  # 결측 → NaN 유지

    # 레이 전체가 격자 밖/결측이면 nanmax가 경고를 내므로 직접 처리
    valid = ~np.isnan(elevation)
    if not valid.any(axis=1).all():
        raise ValueError("a horizon ray has no valid DEM samples")
    best = np.where(valid, elevation, -np.inf).max(axis=1)
    return HorizonProfile(
        azimuth_deg=az_deg, elevation_deg=np.degrees(best), complete=bool(valid.all())
    )
