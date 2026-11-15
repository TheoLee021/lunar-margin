"""극 입체투영 평면(단위 m)의 정규 격자. 격자 원점은 극이라 간격이 정수배인 격자끼리 정렬된다."""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.candidates.config import Roi
from lunar_margin.engine.candidates.projection import polar_radius_m, polar_xy_to_lonlat
from lunar_margin.engine.ephemeris import MOON_RADIUS_M

_TOL_M = 1e-6  # 경계 포함 비교용 오차


@dataclass(frozen=True)
class SitePoints:
    """계산 대상 지점 묶음. 격자 정수 인덱스와 원래의 위경도를 함께 보존한다.

    plan_id: 이 점들을 만든 샘플링 계획 이름 (예: 극지 밀집 격자). 훗날 전역 희소 샘플링 등
    다른 계획과 같은 형태로 합칠 수 있도록 점 묶음마다 출처를 남긴다.
    """

    ix: NDArray[np.int64]  # x = ix * spacing_m
    iy: NDArray[np.int64]  # y = iy * spacing_m
    x_m: NDArray[np.float64]
    y_m: NDArray[np.float64]
    lat_deg: NDArray[np.float64]
    lon_deg: NDArray[np.float64]
    spacing_m: float
    plan_id: str

    def __len__(self) -> int:
        return int(self.ix.shape[0])

    def subset(self, selector: NDArray[np.bool_] | NDArray[np.int64]) -> SitePoints:
        return SitePoints(
            ix=self.ix[selector],
            iy=self.iy[selector],
            x_m=self.x_m[selector],
            y_m=self.y_m[selector],
            lat_deg=self.lat_deg[selector],
            lon_deg=self.lon_deg[selector],
            spacing_m=self.spacing_m,
            plan_id=self.plan_id,
        )


def _build(
    ix: NDArray[np.int64], iy: NDArray[np.int64], spacing_m: float, plan_id: str, radius_m: float
) -> SitePoints:
    x = (ix * spacing_m).astype(np.float64)
    y = (iy * spacing_m).astype(np.float64)
    lat, lon = polar_xy_to_lonlat(x, y, radius_m)
    return SitePoints(ix, iy, x, y, lat, lon, spacing_m, plan_id)


def _inside(
    ix: NDArray[np.int64],
    iy: NDArray[np.int64],
    spacing_m: float,
    roi: Roi,
    radius_m: float,
) -> NDArray[np.bool_]:
    rho = np.hypot(ix * spacing_m, iy * spacing_m)
    rho_min = polar_radius_m(roi.min_lat_deg, radius_m)
    rho_max = polar_radius_m(roi.max_lat_deg, radius_m)
    return (rho <= rho_max + _TOL_M) & (rho >= rho_min - _TOL_M)


def polar_grid(
    roi: Roi,
    spacing_m: float,
    plan_id: str = "south_polar_dense",
    radius_m: float = MOON_RADIUS_M,
) -> SitePoints:
    """ROI 안의 모든 격자점. (iy, ix) 행 우선 순서로 항상 같은 순서를 돌려준다."""
    n = int(polar_radius_m(roi.max_lat_deg, radius_m) // spacing_m) + 1
    iy, ix = np.mgrid[-n : n + 1, -n : n + 1]
    ix, iy = ix.ravel().astype(np.int64), iy.ravel().astype(np.int64)
    keep = _inside(ix, iy, spacing_m, roi, radius_m)
    return _build(ix[keep], iy[keep], spacing_m, plan_id, radius_m)


def refine_points(
    coarse: SitePoints,
    selected: NDArray[np.bool_],
    roi: Roi,
    fine_spacing_m: float,
    radius_m: float = MOON_RADIUS_M,
) -> SitePoints:
    """선택된 거친 점마다 거친 간격 이내(체비쇼프 거리)의 세밀 격자점을 모은다.

    중복 없이, ROI 안의 점만 돌려준다.
    """
    ratio = coarse.spacing_m / fine_spacing_m
    if abs(ratio - round(ratio)) > 1e-9 or ratio < 1.0:
        raise ValueError("coarse spacing must be a whole multiple of the fine spacing")
    m = round(ratio)
    base_ix = coarse.ix[selected] * m
    base_iy = coarse.iy[selected] * m
    offsets = np.arange(-m, m + 1, dtype=np.int64)
    off_y, off_x = np.meshgrid(offsets, offsets, indexing="ij")
    ix = (base_ix[:, None] + off_x.ravel()[None, :]).ravel()
    iy = (base_iy[:, None] + off_y.ravel()[None, :]).ravel()
    keep = _inside(ix, iy, fine_spacing_m, roi, radius_m)
    ix, iy = ix[keep], iy[keep]
    order = np.lexsort((ix, iy))  # (iy, ix) 순으로 정렬해 항상 같은 순서
    ix, iy = ix[order], iy[order]
    if ix.size:
        first = np.ones(ix.size, dtype=np.bool_)
        first[1:] = (ix[1:] != ix[:-1]) | (iy[1:] != iy[:-1])
        ix, iy = ix[first], iy[first]
    return _build(ix, iy, fine_spacing_m, coarse.plan_id, radius_m)
