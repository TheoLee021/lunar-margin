"""LOLA 극 입체투영 DEM (남극). 높이는 반경 1737.4 km 구 기준 상대 높이(m)로 다룬다.

축 방향은 실데이터(Malapert 산, Shoemaker·Haworth·Faustini 크레이터)로 확인했다:
  x = rho*sin(경도), y = rho*cos(경도), col = 중심 + x/scale, row = 중심 - y/scale
즉 경도 0°가 이미지 위쪽, 동쪽(경도 90°)이 오른쪽이다.
"""

import math
from pathlib import Path
from typing import Protocol, Self

import numpy as np
from numpy.typing import NDArray

from lunar_margin.pipeline.pds_label import PolarGridLabel, parse_label


class PolarDem:
    def __init__(self, heights_km: NDArray[np.float32], label: PolarGridLabel) -> None:
        if heights_km.shape != (label.lines, label.samples):
            raise ValueError(f"grid shape {heights_km.shape} does not match label")
        self._h = heights_km
        self.label = label
        self.radius_m = label.radius_km * 1000.0

    @classmethod
    def from_files(cls, img: Path, lbl: Path) -> Self:
        label = parse_label(lbl.read_text(errors="replace"))
        data = np.memmap(img, dtype="<f4", mode="r", shape=(label.lines, label.samples))
        return cls(data, label)

    def lonlat_to_xy(self, lat_deg: float, lon_deg: float) -> tuple[float, float]:
        """극에서의 (x, y) 미터. 극입체투영, 극에서 축척 1."""
        rho = 2.0 * self.radius_m * math.tan(math.radians(90.0 + lat_deg) / 2.0)
        lon = math.radians(lon_deg)
        return rho * math.sin(lon), rho * math.cos(lon)

    def sample_height_m(
        self, x_m: NDArray[np.float64], y_m: NDArray[np.float64]
    ) -> NDArray[np.float64]:
        """쌍선형 보간. 격자 밖이거나 결측(NaN) 픽셀이 걸리면 NaN."""
        scale = self.label.map_scale_m
        col = self.label.sample_offset + x_m / scale
        row = self.label.line_offset - y_m / scale
        inside = (col >= 0) & (col <= self.label.samples - 1) & (row >= 0)
        inside &= row <= self.label.lines - 1
        col = np.where(inside, col, 0.0)
        row = np.where(inside, row, 0.0)
        c0 = np.minimum(np.floor(col).astype(np.int64), self.label.samples - 2)
        r0 = np.minimum(np.floor(row).astype(np.int64), self.label.lines - 2)
        fc, fr = col - c0, row - r0
        h = self._h
        top = h[r0, c0] * (1 - fc) + h[r0, c0 + 1] * fc
        bottom = h[r0 + 1, c0] * (1 - fc) + h[r0 + 1, c0 + 1] * fc
        height_km = top * (1 - fr) + bottom * fr
        return np.where(inside, height_km.astype(np.float64) * 1000.0, np.nan)

    def sample_height_lonlat_m(
        self, lat_deg: NDArray[np.float64], lon_deg: NDArray[np.float64]
    ) -> NDArray[np.float64]:
        """위경도 배열의 높이(m). 격자 밖·결측은 NaN."""
        rho = 2.0 * self.radius_m * np.tan(np.radians(90.0 + lat_deg) / 2.0)
        lon = np.radians(lon_deg)
        return self.sample_height_m(rho * np.sin(lon), rho * np.cos(lon))

    def contains(self, lat_deg: float, lon_deg: float) -> bool:
        """격자 안이고 결측 픽셀이 아니면 True."""
        x, y = self.lonlat_to_xy(lat_deg, lon_deg)
        value = self.sample_height_m(np.array([x]), np.array([y]))[0]
        return bool(not np.isnan(value))

    def height_at(self, lat_deg: float, lon_deg: float) -> float:
        x, y = self.lonlat_to_xy(lat_deg, lon_deg)
        value = float(self.sample_height_m(np.array([x]), np.array([y]))[0])
        if math.isnan(value):
            raise ValueError(f"({lat_deg}, {lon_deg}) is outside the DEM or on a missing pixel")
        return value


class Dem(Protocol):
    """수평선 계산이 DEM에 요구하는 것. PolarDem과 CompositeDem이 이를 만족한다."""

    @property
    def radius_m(self) -> float: ...

    @property
    def label(self) -> PolarGridLabel: ...

    def sample_height_m(
        self, x_m: NDArray[np.float64], y_m: NDArray[np.float64]
    ) -> NDArray[np.float64]: ...

    def sample_height_lonlat_m(
        self, lat_deg: NDArray[np.float64], lon_deg: NDArray[np.float64]
    ) -> NDArray[np.float64]: ...

    def height_at(self, lat_deg: float, lon_deg: float) -> float: ...


class CompositeDem:
    """고해상도 DEM(primary)을 우선 쓰고, 그 밖이나 결측인 곳은 더 넓은 DEM(fallback)으로 메운다.

    두 DEM이 같은 극 입체투영(같은 구, 극이 원점)이라 투영 좌표(m)로 바로 겹쳐 쓸 수 있다.
    수평선 탐색 간격과 격자 정보는 primary를 따른다.
    """

    def __init__(self, primary: PolarDem, fallback: PolarDem) -> None:
        if abs(primary.radius_m - fallback.radius_m) > 1e-6:
            raise ValueError("both DEMs must use the same reference sphere")
        self.primary = primary
        self.fallback = fallback
        self.label = primary.label
        self.radius_m = primary.radius_m

    def sample_height_m(
        self, x_m: NDArray[np.float64], y_m: NDArray[np.float64]
    ) -> NDArray[np.float64]:
        values = self.primary.sample_height_m(x_m, y_m)
        missing = np.isnan(values)
        if missing.any():
            values = np.where(missing, self.fallback.sample_height_m(x_m, y_m), values)
        return values

    def sample_height_lonlat_m(
        self, lat_deg: NDArray[np.float64], lon_deg: NDArray[np.float64]
    ) -> NDArray[np.float64]:
        values = self.primary.sample_height_lonlat_m(lat_deg, lon_deg)
        missing = np.isnan(values)
        if missing.any():
            values = np.where(
                missing, self.fallback.sample_height_lonlat_m(lat_deg, lon_deg), values
            )
        return values

    def height_at(self, lat_deg: float, lon_deg: float) -> float:
        try:
            return self.primary.height_at(lat_deg, lon_deg)
        except ValueError:
            return self.fallback.height_at(lat_deg, lon_deg)

    def contains(self, lat_deg: float, lon_deg: float) -> bool:
        return self.primary.contains(lat_deg, lon_deg) or self.fallback.contains(lat_deg, lon_deg)
