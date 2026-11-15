"""Independent numerical cross-checks for the draft lunar descent reference.

These test the idealized constant-spin, point-mass model implemented in
PR #69. They are not flight validation or a realistic guidance test.
"""

import math

import numpy as np
import pytest
from numpy.typing import NDArray
from scipy.integrate import solve_ivp

from lunar_margin.engine.descent_reference import (
    G0,
    MU_M,
    OMEGA,
    R_M,
    Lander,
    _trajectory_at_times,
    evaluate_reference,
    pdi_from_target,
    surface_vector,
)

Vec = NDArray[np.float64]


class FlatDem:
    def sample_height_lonlat_m(self, lat_deg: Vec, lon_deg: Vec) -> Vec:
        return np.zeros_like(lat_deg)


def _rotation_z(theta: float) -> Vec:
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


def test_subsample_thrust_peak_rejects_marginal_engine() -> None:
    """The maximum at t~120 s can fall between the 5-s output knots."""
    pdi = pdi_from_target(-89.0, 30.0)
    path = evaluate_reference(
        FlatDem(),
        pdi,
        -89.0,
        30.0,
        Lander(max_thrust_n=6170.0),
        duration_s=600.0,
    )
    assert path.status == "ENGINE_LIMIT"
    assert path.max_thrust_n is not None
    assert path.max_thrust_n > 6170.0
    # Do not quietly change the public output grid just to improve
    # physics sampling; it remains the coarse (~5-s) presentation grid.
    assert len(path.samples) <= 40


def test_reference_acceleration_reintegrates_in_inertial_frame() -> None:
    """Forward-integrate independent Newtonian equations from the PDI state.

    Uses the inverse-dynamics acceleration implied by the polynomial as
    a known time-dependent command; tests the rotating/inertial signs
    and boundary conditions, not the physical realizability of guidance.
    """
    pdi = pdi_from_target(-89.0, 30.0)
    duration = 480.0
    loft = 2000.0
    omega = np.array([0.0, 0.0, OMEGA])
    target = R_M * surface_vector(-89.0, 30.0)
    starting_inertial_velocity = pdi.velocity_mps + np.cross(omega, pdi.position_m)

    def thrust_command(t_s: float) -> Vec:
        t = np.array([t_s], dtype=np.float64)
        r, v, a = _trajectory_at_times(pdi, target, duration, loft, t)
        radius = float(np.linalg.norm(r[0]))
        gravity = -MU_M * r[0] / radius**3
        thrust_moon_fixed = (
            a[0] - gravity + 2.0 * np.cross(omega, v[0]) + np.cross(omega, np.cross(omega, r[0]))
        )
        return _rotation_z(OMEGA * t_s) @ thrust_moon_fixed

    def rhs(t_s: float, state: Vec) -> Vec:
        radius = float(np.linalg.norm(state[:3]))
        inertial_acc = -MU_M * state[:3] / radius**3 + thrust_command(t_s)
        return np.concatenate((state[3:], inertial_acc))

    initial = np.concatenate((pdi.position_m, starting_inertial_velocity))
    solution = solve_ivp(
        rhs,
        (0.0, duration),
        initial,
        rtol=1e-10,
        atol=1e-8,
        max_step=2.0,
    )
    assert solution.success
    rot_back = _rotation_z(-OMEGA * duration)
    r_end = rot_back @ solution.y[:3, -1]
    v_end = rot_back @ solution.y[3:, -1] - np.cross(omega, r_end)
    assert np.linalg.norm(r_end - target) < 0.01
    assert np.linalg.norm(v_end) < 1e-4

    reference = evaluate_reference(
        FlatDem(), pdi, -89.0, 30.0, Lander(), duration_s=duration, loft_m=loft
    )
    assert reference.propellant_kg is not None
    t_quadrature = np.linspace(0.0, duration, 4801)
    acc = np.array([np.linalg.norm(thrust_command(float(t))) for t in t_quadrature])
    independent_final_mass = 1200.0 * math.exp(
        -float(np.trapezoid(acc, t_quadrature)) / (310.0 * G0)
    )
    assert reference.propellant_kg == pytest.approx(1200.0 - independent_final_mass, abs=0.05)
