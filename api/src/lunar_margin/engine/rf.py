"""Nominal DTE link budget: Earth-center terrain LOS remains a required gate.

Team baseline: NASA/TM-20220013310 Fig. 5.33 and ETSI EN 302 307-1
V1.4.1 Table 13, QPSK 1/4 normal FECFRAME, no pilots. This does not
model an actual ground station, its schedule, atmosphere or multipath.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from lunar_margin.engine.candidates.config import AnalysisWindow
from lunar_margin.engine.ephemeris import MOON_RADIUS_M


class RFScenario(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    frequency_hz: float = Field(default=23.17e9, gt=0)
    tx_power_w: float = Field(default=1.0, gt=0)
    tx_gain_dbi: float = 33.2
    rx_gain_dbi: float = 71.1
    tx_system_loss_db: float = Field(default=1.0, ge=0)
    tx_pointing_loss_db: float = Field(default=0.3, ge=0)
    rx_pointing_loss_db: float = Field(default=0.0, ge=0)
    rx_waveguide_loss_db: float = Field(default=0.0, ge=0)
    system_noise_temp_k: float = Field(default=512.0, gt=0)
    information_rate_bps: float = Field(default=230_000.0, gt=0)
    implementation_loss_db: float = Field(default=3.0, ge=0)
    target_margin_db: float = Field(default=3.0, ge=0)
    required_esn0_db: float = -2.35
    eta_tot: float = Field(default=0.490243, gt=0)

    @property
    def required_ebn0_db(self) -> float:
        return self.required_esn0_db - 10 * math.log10(self.eta_tot)

    @property
    def rx_required_dbw(self) -> float:
        return (
            -228.60
            + 10 * math.log10(self.system_noise_temp_k)
            + 10 * math.log10(self.information_rate_bps)
            + self.required_ebn0_db
            + self.implementation_loss_db
        )

    def margin_db(self, range_km: NDArray[np.float64]) -> NDArray[np.float64]:
        if not np.all(np.isfinite(range_km) & (range_km > 0)):
            raise ValueError("RF range must be positive and finite")
        fspl = 20 * np.log10(4 * np.pi * range_km * 1000 * self.frequency_hz / 299_792_458.0)
        losses = (
            self.tx_system_loss_db
            + self.tx_pointing_loss_db
            + self.rx_pointing_loss_db
            + self.rx_waveguide_loss_db
        )
        return (
            10 * math.log10(self.tx_power_w)
            + self.tx_gain_dbi
            + self.rx_gain_dbi
            - fspl
            - losses
            - self.rx_required_dbw
        )


def summarize_rf(
    scenario: RFScenario,
    vectors_km: NDArray[np.float64],
    visible: NDArray[np.bool_],
    window: AnalysisWindow,
    lat_deg: float,
    lon_deg: float,
    observer_height_m: float,
) -> tuple[float, float, float]:
    """Duration-weighted fraction, longest outage hours, minimum nominal LOS margin.

    The final sample covers only the remaining [start,end) interval. Margin is
    hypothetical free-space LOS power even when terrain blocks the Earth.
    """
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    up = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    observer = up * (MOON_RADIUS_M + observer_height_m) / 1000
    margins = scenario.margin_db(np.linalg.norm(vectors_km - observer, axis=1))
    total_s = (window.end - window.start).total_seconds()
    durations = np.minimum(
        window.step_minutes * 60, total_s - np.arange(len(visible)) * window.step_minutes * 60
    )
    if len(visible) != window.sample_count() or not np.all(durations > 0):
        raise ValueError("RF samples must exactly cover the analysis window")
    available = visible & (margins >= scenario.target_margin_db)
    ends = np.cumsum(durations)
    last_available_end = np.maximum.accumulate(np.where(available, ends, 0))
    longest = float(np.max(ends - last_available_end)) / 3600
    return float(durations[available].sum() / total_s), longest, float(margins.min())
