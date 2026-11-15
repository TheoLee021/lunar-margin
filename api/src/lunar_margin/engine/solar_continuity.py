"""Sun-only geometric visibility continuity based on the original site-trade baseline.

This models consecutive above-terrain Sun-center LOS samples, *not* solar
power, insolation, thermal balance or any direct-to-Earth communications.
"""

import math
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
    *,
    duration_minutes: float,
) -> SolarContinuity:
    """Summarize uniformly sampled geometric Sun LOS.

    Each sample represents at most step_minutes, clipped to the requested end.
    The final partial interval must never be counted as a full sample.
    """
    if visible.ndim != 1 or visible.size == 0:
        raise ValueError("sun visibility must be a nonempty 1D series")
    if visible.dtype != np.dtype("bool"):
        raise ValueError("sun visibility must contain booleans")
    if step_minutes <= 0:
        raise ValueError("step_minutes must be positive")

    if not math.isfinite(duration_minutes) or duration_minutes <= 0:
        raise ValueError("duration_minutes must be positive and finite")
    durations = np.minimum(step_minutes, duration_minutes - np.arange(visible.size) * step_minutes)
    if np.any(durations <= 0):
        raise ValueError("sun visibility contains samples outside the requested interval")
    runs = find_runs(visible, True)
    longest_minutes = max((float(durations[start:end].sum()) for start, end in runs), default=0.0)
    transitions = int(np.count_nonzero(visible[1:] != visible[:-1]))
    return SolarContinuity(
        longest_sun_visible_hours=float(longest_minutes / 60.0),
        visibility_transitions=transitions,
    )
