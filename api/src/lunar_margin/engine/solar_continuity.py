"""Sun-only geometric visibility continuity based on the original site-trade baseline.

This models consecutive above-terrain Sun-center LOS samples, *not* solar
power, insolation, thermal balance or any direct-to-Earth communications.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.metrics import find_runs


@dataclass(frozen=True)
class SolarContinuity:
    longest_sun_visible_hours: float
    visibility_transitions: int


def summarize_solar_continuity(
    visible: NDArray[np.bool_],
    step_minutes: int,
) -> SolarContinuity:
    """Summarize uniformly sampled geometric Sun LOS.

    A run extends to the next sample boundary, like existing time-window
    metrics; this is sample-grid resolution, not a sub-minute event prediction.
    """
    if visible.ndim != 1 or visible.size == 0:
        raise ValueError("sun visibility must be a nonempty 1D series")
    if visible.dtype != np.dtype("bool"):
        raise ValueError("sun visibility must contain booleans")
    if step_minutes <= 0:
        raise ValueError("step_minutes must be positive")

    runs = find_runs(visible, True)
    longest_samples = max((end - start for start, end in runs), default=0)
    transitions = int(np.count_nonzero(visible[1:] != visible[:-1]))
    return SolarContinuity(
        longest_sun_visible_hours=float(longest_samples * step_minutes / 60.0),
        visibility_transitions=transitions,
    )
