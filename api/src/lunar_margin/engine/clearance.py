"""Terrain-horizon clearance diagnostics for geometric Sun/Earth LOS.

Ported from the team's earlier independent baseline. This adds *no* RF link
budget, antenna model, or change to existing candidate ranking/visibility.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.horizon import HorizonProfile


@dataclass(frozen=True)
class ClearanceDiagnostics:
    clearance_deg: NDArray[np.float64]
    visible_clearance_p10_deg: float | None


def terrain_clearance_diagnostics(
    horizon: HorizonProfile,
    azimuth_deg: NDArray[np.float64],
    elevation_deg: NDArray[np.float64],
) -> ClearanceDiagnostics:
    """Compute center-of-body elevation minus terrain-horizon elevation (deg).

    Positive clearance corresponds to the existing geometric visibility rule.
    P10 uses only positive-clearance time samples; None means no visible samples.
    This is a geometric margin, NOT an RF link margin or uncertainty bound.
    """
    if azimuth_deg.shape != elevation_deg.shape or azimuth_deg.ndim != 1:
        raise ValueError("azimuth/elevation must be matching 1D arrays")
    if not azimuth_deg.size:
        raise ValueError("empty LOS series")
    if not np.isfinite(azimuth_deg).all() or not np.isfinite(elevation_deg).all():
        raise ValueError("non-finite LOS angle")
    clearance = elevation_deg - horizon.at(azimuth_deg)
    if not np.isfinite(clearance).all():
        raise ValueError("non-finite terrain clearance")
    positive = clearance[clearance > 0.0]
    return ClearanceDiagnostics(
        clearance_deg=clearance,
        visible_clearance_p10_deg=(
            float(np.percentile(positive, 10)) if positive.size else None
        ),
    )
