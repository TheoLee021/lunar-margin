"""햇빛 지도: 태양 방향 하나에 대해, 극 격자의 각 지점에서 지형에 가리지 않고 보이는
태양 원반의 비율.

태양은 멀어서 빛이 평행하다. 극축과 태양 방향을 포함하는 평면에 평행한 "빛의 면"마다
지형 단면을 태양 쪽에서부터 훑으면, 어떤 점이 그늘인지는 그보다 태양 쪽에 있는 점들의
누적 최댓값 하나로 정해진다: 고도 e의 광선 위에서 `높이 - 거리 * tan(e)`는 일정하므로,
이 값이 더 큰 점이 태양 쪽에 있으면 가린다. 달의 곡률은 3차원 좌표로 계산해서 그대로 들어간다.
"""

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy.ndimage import map_coordinates

from lunar_margin.engine.dem import Dem

SUN_RADIUS_DEG = 0.2665
# 태양 원반을 고도 방향으로 나눈 띠의 수. 반그림자가 이 수 + 1 단계로 표현된다
DISC_STRIPS = 16
# 격자 밖 지형은 이 배수만큼 거친 간격으로 훑는다 (멀리서 오는 그림자는 경계가 넓게 퍼진다)
FAR_COARSENING = 4
# 같은 높이의 이웃을 가림으로 세지 않기 위한 여유 (m)
_TOLERANCE_M = 0.01
_CHUNK_ROWS = 256


@dataclass(frozen=True)
class SunlightGrid:
    """남극 입체투영 격자. 픽셀 (col, row)는 x = (col - center_px) * pixel_size_m,
    y = (center_px - row) * pixel_size_m (x는 경도 90°E 쪽, y는 경도 0° 쪽)."""

    pixel_size_m: float
    center_px: int

    @property
    def size_px(self) -> int:
        return 2 * self.center_px + 1


def _mesh(
    columns: NDArray[np.float64], rows: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    first, second = np.meshgrid(columns, rows)
    return first.astype(np.float64), second.astype(np.float64)


def _sheet_coordinates(
    dem: Dem,
    along_m: NDArray[np.float64],
    across_m: NDArray[np.float64],
    towards_sun: tuple[float, float],
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """극의 접평면에서 태양 쪽으로 along, 그 오른쪽으로 across만큼 떨어진 연직선 위의 지표점.

    그 점이 실제로 태양 쪽으로 떨어진 수평 거리와, 극 접평면 위 높이를 돌려준다 (DEM 밖은 NaN).
    """
    sun_x, sun_y = towards_sun  # 세계 좌표 X(경도 0°), Y(경도 90°E) 성분
    world_x = along_m * sun_x - across_m * sun_y
    world_y = along_m * sun_y + across_m * sun_x
    horizontal = np.hypot(world_x, world_y)
    radius = np.full_like(horizontal, dem.radius_m)
    for _ in range(3):  # 지표 높이만큼 반지름이 달라지므로 몇 번 되풀이해 맞춘다
        colatitude = np.arcsin(np.minimum(horizontal / radius, 1.0))
        rho = 2.0 * dem.radius_m * np.tan(colatitude / 2.0)
        scale = np.divide(rho, horizontal, out=np.ones_like(rho), where=horizontal > 0)
        radius = dem.radius_m + dem.sample_height_m(world_y * scale, world_x * scale)
    colatitude = np.arcsin(np.minimum(horizontal / radius, 1.0))
    return along_m, radius * np.cos(colatitude) - dem.radius_m


def sunlit_fraction(
    dem: Dem,
    sun_me: tuple[float, float, float],
    grid: SunlightGrid,
    *,
    reach_m: float = 200_000.0,
) -> NDArray[np.float32]:
    """grid의 각 픽셀에서 보이는 태양 원반의 비율 (0 = 완전한 그늘, 1 = 전부 보임).

    sun_me는 달에서 태양을 향하는 MOON_ME 방향. grid 밖 지형도 태양 쪽으로 reach_m까지 살핀다.
    """
    norm = math.sqrt(sum(c * c for c in sun_me))
    horizontal = math.hypot(sun_me[0], sun_me[1])
    if norm == 0.0 or horizontal / norm < 1e-6:
        raise ValueError("the Sun direction needs a horizontal component at the pole")
    towards_sun = (sun_me[0] / horizontal, sun_me[1] / horizontal)
    elevation = math.atan2(-sun_me[2], horizontal)  # 남극의 위쪽은 -Z

    step = grid.pixel_size_m
    half = grid.center_px * step
    axis = (np.arange(grid.size_px, dtype=np.float64) - grid.center_px) * step
    far_step = step * FAR_COARSENING
    far_axis = half + far_step * np.arange(1, math.ceil(reach_m / far_step) + 1, dtype=np.float64)
    far_across = np.arange(-half, half + far_step, far_step, dtype=np.float64)
    far_along, far_height = _sheet_coordinates(dem, *_mesh(far_axis, far_across), towards_sun)

    offsets = (np.arange(DISC_STRIPS) + 0.5) * (2.0 / DISC_STRIPS) - 1.0
    slopes = np.tan(elevation + np.radians(offsets * SUN_RADIUS_DEG))
    weights = np.sqrt(1.0 - offsets**2)  # 원반에서 그 고도의 띠가 차지하는 넓이
    weights = (weights / weights.sum()).astype(np.float32)
    # 격자 밖(태양 쪽) 지형이 각 빛의 면에 드리우는 문턱값, 띠마다
    beyond = [
        np.interp(
            axis,
            far_across,
            np.where(np.isnan(far_height), -np.inf, far_height - far_along * slope).max(axis=1),
        )
        for slope in slopes
    ]

    # 빛의 면 격자: 열 = 태양 쪽 거리, 행 = 빛의 면.
    # 면끼리는 독립이라 행 묶음으로 나눠 메모리를 아낀다
    lit = np.zeros((grid.size_px, grid.size_px), dtype=np.float32)
    for start in range(0, grid.size_px, _CHUNK_ROWS):
        rows = slice(start, start + _CHUNK_ROWS)
        along, height = _sheet_coordinates(dem, *_mesh(axis, axis[rows]), towards_sun)
        for slope, weight, threshold in zip(slopes, weights, beyond, strict=True):
            key = np.where(np.isnan(height), -np.inf, height - along * slope)
            # 각 점보다 태양 쪽에 있는 점들의 최댓값
            ahead = np.maximum.accumulate(key[:, ::-1], axis=1)[:, ::-1]
            ahead = np.concatenate([ahead[:, 1:], np.full((key.shape[0], 1), -np.inf)], axis=1)
            np.maximum(ahead, threshold[rows, None], out=ahead)
            lit[rows] += weight * (key > ahead - _TOLERANCE_M)

    # 빛의 면 격자에서 극 입체투영 격자로 옮긴다
    image = np.empty_like(lit)
    for start in range(0, grid.size_px, _CHUNK_ROWS):
        rows = slice(start, start + _CHUNK_ROWS)
        x, y = _mesh(axis, -axis[rows])
        rho = np.hypot(x, y)
        colatitude = 2.0 * np.arctan(rho / (2.0 * dem.radius_m))
        radius = dem.radius_m + np.nan_to_num(dem.sample_height_m(x, y))
        scale = np.divide(radius * np.sin(colatitude), rho, out=np.ones_like(rho), where=rho > 0)
        world_x, world_y = y * scale, x * scale
        column = (world_x * towards_sun[0] + world_y * towards_sun[1]) / step + grid.center_px
        row = (world_y * towards_sun[0] - world_x * towards_sun[1]) / step + grid.center_px
        image[rows] = map_coordinates(lit, [row, column], order=1, mode="nearest")
    return image
