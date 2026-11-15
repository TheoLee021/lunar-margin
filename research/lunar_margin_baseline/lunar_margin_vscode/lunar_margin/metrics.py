"""Time-series metrics for illumination and DTE geometric access."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Sequence

import numpy as np


@dataclass
class VisibilitySummary:
    availability_fraction: float
    longest_visible_hours: float
    longest_blocked_hours: float
    transitions: int


def _longest_run(mask: np.ndarray, target: bool) -> int:
    best = 0
    current = 0
    for value in mask:
        if bool(value) is target:
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best


def summarize_binary_visibility(
    times_utc: Sequence[str],
    visible: Sequence[bool],
) -> VisibilitySummary:
    """Summarize a regularly sampled binary visibility time series."""
    mask = np.asarray(visible, dtype=bool)
    if len(mask) == 0:
        raise ValueError("visible sequence is empty")
    if len(times_utc) != len(mask):
        raise ValueError("times_utc and visible must have the same length")

    if len(mask) >= 2:
        t0 = datetime.fromisoformat(times_utc[0].replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(times_utc[1].replace("Z", "+00:00"))
        dt_hours = (t1 - t0).total_seconds() / 3600.0
    else:
        dt_hours = 0.0

    transitions = int(np.count_nonzero(mask[1:] != mask[:-1])) if len(mask) > 1 else 0

    return VisibilitySummary(
        availability_fraction=float(mask.mean()),
        longest_visible_hours=float(_longest_run(mask, True) * dt_hours),
        longest_blocked_hours=float(_longest_run(mask, False) * dt_hours),
        transitions=transitions,
    )
