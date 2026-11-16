"""Synthetic validation for the preliminary 15-km PDI feasibility module.

Real LOLA integration still needs an independent flight-dynamics benchmark.
"""

import math

import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.engine.descent_los import terrain_los
from lunar_margin.engine.descent_reference import (
    MU_M,
    R_M,
    Lander,
    evaluate_alternatives,
    evaluate_reference,
    pdi_from_target,
)

Vec = NDArray[np.float64]


class FlatDem:
    def sample_height_lonlat_m(self, lat_deg: Vec, lon_deg: Vec) -> Vec:
        return np.zeros_like(lat_deg)


class MissingDem:
    def sample_height_lonlat_m(self, lat_deg: Vec, lon_deg: Vec) -> Vec:
        return np.full_like(lat_deg, np.nan)


class RidgeDem:
    def sample_height_lonlat_m(self, lat_deg: Vec, lon_deg: Vec) -> Vec:
        return np.where((lat_deg > -85.5) & (lat_deg < -85.0), 25_000.0, 0.0)


def test_100x15km_reference_matches_vis_viva() -> None:
    state = pdi_from_target(-89.0, 30.0)
    ra, rp = R_M + 100_000, R_M + 15_000
    semimajor = (ra + rp) / 2
    expected_vp = math.sqrt(MU_M * (2 / rp - 1 / semimajor))
    assert np.linalg.norm(state.position_m) - R_M == pytest.approx(15_000.0)
    assert np.linalg.norm(state.velocity_mps) == pytest.approx(expected_vp, abs=5.0)
    assert state.doi_delta_v_mps == pytest.approx(19.45507335, rel=1e-7)
    assert state.doi_to_pdi_s == pytest.approx(3411.836, abs=0.01)


def test_flat_surface_reference_touches_down_with_zero_final_speed() -> None:
    state = pdi_from_target(-89.0, 30.0)
    path = evaluate_reference(FlatDem(), state, -89.0, 30.0, Lander(), duration_s=480.0)
    assert path.status == "REFERENCE_FEASIBLE"
    assert path.samples[-1].altitude_agl_m == pytest.approx(0, abs=0.01)
    assert path.samples[-1].speed_mps == pytest.approx(0, abs=0.01)
    assert path.propellant_kg is not None and 0 < path.propellant_kg < 750
    assert path.max_thrust_n is not None and path.max_thrust_n < 15_000


def test_rejects_ridge_intersection() -> None:
    state = pdi_from_target(-89.0, 30.0)
    path = evaluate_reference(RidgeDem(), state, -89.0, 30.0, Lander(), duration_s=480.0)
    assert path.status == "TERRAIN_COLLISION"
    assert path.min_clearance_m is not None and path.min_clearance_m < 0


def test_does_not_label_unknown_dem_safe() -> None:
    state = pdi_from_target(-89.0, 30.0)
    path = evaluate_reference(MissingDem(), state, -89.0, 30.0, Lander(), duration_s=480.0)
    assert path.status == "TERRAIN_UNKNOWN"
    assert path.samples == []


def test_rejects_insufficient_fuel_or_thrust() -> None:
    state = pdi_from_target(-89.0, 30.0)
    insufficient_fuel = Lander(wet_mass_kg=1200, dry_mass_kg=1150)
    insufficient_thrust = Lander(max_thrust_n=800)
    fuel = evaluate_reference(FlatDem(), state, -89.0, 30.0, insufficient_fuel, duration_s=480.0)
    engine = evaluate_reference(
        FlatDem(), state, -89.0, 30.0, insufficient_thrust, duration_s=480.0
    )
    assert fuel.status == "FUEL_LIMIT"
    assert engine.status == "ENGINE_LIMIT"


def test_alternates_share_the_same_pdi_state() -> None:
    state = pdi_from_target(-89.0, 30.0)
    result = evaluate_alternatives(
        FlatDem(),
        state,
        [(-89.0, 30.0), (-89.001, 30.02)],
        Lander(),
    )
    assert len(result) == 2
    assert all(item.status == "REFERENCE_FEASIBLE" for item in result)
    assert all(
        item.samples[0].moon_me_xyz_m == result[0].samples[0].moon_me_xyz_m for item in result
    )


def test_geometric_los_blocked_visible_unknown() -> None:
    observer = np.array([R_M + 10, 0.0, 0.0])
    outward = np.array([300_000_000.0, 0.0, 0.0])
    through_moon = np.array([-300_000_000.0, 0.0, 0.0])
    assert terrain_los(FlatDem(), observer, outward) == "VISIBLE"
    assert terrain_los(FlatDem(), observer, through_moon) == "BLOCKED"
    assert terrain_los(MissingDem(), observer, outward) == "UNKNOWN"


def test_rejects_invalid_inputs() -> None:
    with pytest.raises(ValueError):
        Lander(wet_mass_kg=100, dry_mass_kg=120)
    with pytest.raises(ValueError):
        pdi_from_target(float("nan"), 0)
    with pytest.raises(ValueError):
        evaluate_reference(
            FlatDem(),
            pdi_from_target(-89.0, 30.0),
            -89.0,
            30.0,
            Lander(),
            duration_s=10,
        )


def test_outward_los_above_negative_elevation_terrain() -> None:
    class CraterFloor:
        def sample_height_lonlat_m(self, lat_deg: Vec, lon_deg: Vec) -> Vec:
            return np.full_like(lat_deg, -2000.0)

    observer = np.array([0.0, 0.0, -(R_M - 1000)])
    assert terrain_los(CraterFloor(), observer, np.array([0.0, 0.0, -384400000.0])) == "VISIBLE"
