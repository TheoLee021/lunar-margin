"""00J pricing model. Raw USD stay unrounded until presentation."""

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel

from lunar_margin.engine.dem import Dem

Delivery = Literal["orbit", "surface", "rover_delivery"]
TARIFFS: dict[Delivery, float] = {"orbit": 300_000, "surface": 1_200_000,
                                  "rover_delivery": 4_500_000}  # fmt: skip
TARIFF_SOURCE = "https://www.astrobotic.com/wp-content/uploads/2022/01/PUGLanders_011222.pdf"
FIXED_LOW = 500_000.0
FIXED_HIGH = 5_000_000.0


@dataclass(frozen=True)
class Terrain:
    landable_fraction: float | None
    aim_slope_deg: float | None


def terrain_at(dem: Dem, x_m: float, y_m: float) -> Terrain:
    """80m DEM samples, central-difference slopes, R=500m, theta=10deg.

    Missing samples make r unknown rather than silently shrinking its denominator.
    This modeled slope scale cannot resolve rocks or subpixel hazards.
    """
    step = dem.label.map_scale_m

    def slopes(x: NDArray[np.float64], y: NDArray[np.float64]) -> NDArray[np.float64]:
        dx = (dem.sample_height_m(x + step, y) - dem.sample_height_m(x - step, y)) / (2 * step)
        dy = (dem.sample_height_m(x, y + step) - dem.sample_height_m(x, y - step)) / (2 * step)
        return np.degrees(np.arctan(np.hypot(dx, dy)))

    # Align samples with the native raster, not the 500m price grid.
    x0 = -dem.label.sample_offset * step
    y0 = dem.label.line_offset * step
    xs = (
        x0
        + np.arange(math.ceil((x_m - 500 - x0) / step), math.floor((x_m + 500 - x0) / step) + 1)
        * step
    )
    ys = (
        y0
        + np.arange(math.ceil((y_m - 500 - y0) / step), math.floor((y_m + 500 - y0) / step) + 1)
        * step
    )
    xx, yy = np.meshgrid(xs, ys)
    inside = (xx - x_m) ** 2 + (yy - y_m) ** 2 <= 500**2
    values = slopes(xx[inside].astype(np.float64), yy[inside].astype(np.float64))
    r = float(np.mean(values <= 10)) if values.size and np.isfinite(values).all() else None
    aim = float(slopes(np.array([x_m]), np.array([y_m]))[0])
    return Terrain(r, aim if math.isfinite(aim) else None)


class Price(BaseModel):
    baseline_usd: float
    transport_usd: float
    destination_adjustment_usd: float
    demand_adjustment_usd: float
    fixed_usd: float = FIXED_LOW
    adjusted_usd: float
    range_low_usd: float
    range_high_usd: float
    destination_multiplier: float
    demand_multiplier: float
    destination_unknown: bool
    demand_unknown: bool
    grade: Literal["modeled"] = "modeled"


def quote(
    *,
    mass_kg: float,
    delivery: Delivery,
    landable_fraction: float | None,
    persona_count: int | None = None,
) -> Price | None:
    if not math.isfinite(mass_kg) or mass_kg <= 0:
        raise ValueError("mass_kg must be finite and positive")
    if landable_fraction is not None:
        if not math.isfinite(landable_fraction) or not 0 <= landable_fraction <= 1:
            raise ValueError("landable_fraction must be between 0 and 1")
        if landable_fraction < 0.05:
            return None
    if persona_count is not None and (not 1 <= persona_count <= 6):
        raise ValueError("persona_count must be 1..6, or None when unknown")
    destination = 1.10 if landable_fraction is None else 1 + 0.30 * (1 - landable_fraction)
    demand = 1.0 if persona_count is None else 1 + 0.08 * (persona_count - 1)
    transport = TARIFFS[delivery] * mass_kg
    destination_adjustment = transport * (destination - 1)
    demand_adjustment = transport * destination * (demand - 1)
    adjusted = FIXED_LOW + transport * destination * demand
    if not math.isfinite(adjusted):
        raise ValueError("price exceeds numeric range")
    return Price(
        baseline_usd=FIXED_LOW + transport,
        transport_usd=transport,
        destination_adjustment_usd=destination_adjustment,
        demand_adjustment_usd=demand_adjustment,
        adjusted_usd=adjusted,
        range_low_usd=adjusted,
        range_high_usd=adjusted + FIXED_HIGH - FIXED_LOW,
        destination_multiplier=destination,
        demand_multiplier=demand,
        destination_unknown=landable_fraction is None,
        demand_unknown=persona_count is None,
    )
