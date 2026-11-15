import numpy as np
import pytest

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.pricing import quote, terrain_at
from lunar_margin.pipeline.pds_label import PolarGridLabel


def test_spec_worked_example_keeps_fixed_fee_outside_multipliers() -> None:
    price = quote(mass_kg=24, delivery="surface", landable_fraction=None, persona_count=3)
    assert price is not None
    assert price.baseline_usd == 29_300_000
    assert price.adjusted_usd == pytest.approx(37_248_800)
    assert price.range_low_usd == pytest.approx(37_248_800)
    assert price.range_high_usd == pytest.approx(41_748_800)
    assert price.destination_multiplier == 1.10
    assert price.demand_multiplier == 1.16
    assert price.destination_unknown


@pytest.mark.parametrize("r, expected", [(1, 29_300_000), (0.5, 33_620_000), (0.05, 37_508_000)])
def test_published_spec_terrain_vectors(r: float, expected: float) -> None:
    price = quote(mass_kg=24, delivery="surface", landable_fraction=r, persona_count=1)
    assert price is not None and price.adjusted_usd == pytest.approx(expected)
    assert not price.destination_unknown and not price.demand_unknown


def test_unlandable_is_absent_and_unknown_demand_does_not_become_zero() -> None:
    assert quote(mass_kg=24, delivery="surface", landable_fraction=0.049) is None
    price = quote(mass_kg=24, delivery="surface", landable_fraction=1)
    assert price is not None and price.demand_unknown and price.demand_multiplier == 1


@pytest.mark.parametrize("mass", [0, -1, float("nan"), float("inf")])
def test_invalid_mass_is_rejected(mass: float) -> None:
    with pytest.raises(ValueError):
        quote(mass_kg=mass, delivery="surface", landable_fraction=1)


def test_terrain_uses_dem_slope_inside_500m_circle_and_marks_missing_unknown() -> None:
    label = PolarGridLabel(41, 41, 80, 20, 20, 1737.4, 0, -90)
    flat = PolarDem(np.zeros((41, 41), dtype=np.float32), label)
    terrain = terrain_at(flat, 0, 0)
    assert terrain.landable_fraction == 1 and terrain.aim_slope_deg == 0
    x = (np.arange(41) - 20) * 80
    plane = np.tile(x * np.tan(np.radians(15)) / 1000, (41, 1)).astype(np.float32)
    steep = terrain_at(PolarDem(plane, label), 0, 0)
    assert steep.landable_fraction == 0
    assert steep.aim_slope_deg == pytest.approx(15, abs=0.01)
    missing = terrain_at(flat, 1520, 0)
    assert missing.landable_fraction is None
