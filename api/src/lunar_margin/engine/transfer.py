"""Dated Earth-Moon preview: Lambert seed + Earth/Moon numerical shooting.

Free parking-orbit orientation, targeting an altitude-100-km lunar perilune
at the requested arrival time. Impulsive tangential circularization at perilune.
No launch-site/ascent, Sun gravity, oblateness, finite burns or landing model.
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from time import monotonic

import numpy as np
from numpy.typing import NDArray
from scipy.integrate import solve_ivp
from scipy.interpolate import CubicHermiteSpline
from scipy.optimize import brentq, root

from lunar_margin.engine.ephemeris import (
    elapsed_si_seconds,
    ephemeris_time,
    inertial_moon_state_to_moon_me,
    load_kernels,
    moon_fixed_direction_to_j2000,
    moon_states,
)

Vec = NDArray[np.float64]
MU_E = 398600.435436
MU_M = 4902.800066
R_E = 6378.1363
R_M = 1737.4
PARKING = 200.0
ARRIVAL_HEIGHT = 100.0
POST_SECONDS = 14 * 3600.0


@dataclass(frozen=True)
class OrbitSample:
    seconds: float
    spacecraft_km: list[float]
    moon_km: list[float]


@dataclass(frozen=True)
class TransferMetrics:
    travel_time_days: float
    parking_orbit_altitude_km: float
    arrival_altitude_km: float
    arrival_position_error_km: float
    tli_delta_v_km_s: float
    loi_delta_v_km_s: float
    total_impulsive_delta_v_km_s: float
    post_loi_min_altitude_km: float


@dataclass(frozen=True)
class LoiHandoff:
    """Physical LOI boundary, before and after impulsive circularization.

    Each 6D state is position followed by velocity. J2000 states are relative
    to the Moon center (km, km/s); MOON_ME states are (m, m/s). This is not
    a surface-targeted descent orbit or a modeled post-LOI maneuver.
    """

    epoch_utc: datetime
    center: str
    inertial_frame: str
    fixed_frame: str
    pre_loi_j2000_km_kmps: list[float]
    post_loi_j2000_km_kmps: list[float]
    pre_loi_moon_me_m_mps: list[float]
    post_loi_moon_me_m_mps: list[float]


@dataclass(frozen=True)
class TransferResult:
    departure: datetime
    arrival: datetime
    model: str
    earth_radius_km: float
    moon_radius_km: float
    plane_x: list[float]
    plane_y: list[float]
    capture_plane_x: list[float]
    capture_plane_y: list[float]
    metrics: TransferMetrics
    transfer: list[OrbitSample]
    capture: list[OrbitSample]
    moon_orbit_km: list[list[float]]
    loi_handoff: LoiHandoff


def _stumpff(z: float) -> tuple[float, float]:
    if abs(z) < 1e-7:
        return 0.5 - z / 24, 1 / 6 - z / 120
    q = math.sqrt(abs(z))
    if z > 0:
        return (1 - math.cos(q)) / z, (q - math.sin(q)) / q**3
    return (1 - math.cosh(q)) / z, (math.sinh(q) - q) / q**3


def _lambert(r1: Vec, r2: Vec, duration: float, normal: Vec) -> Vec:
    """Zero-revolution universal-variable Lambert departure velocity (km/s)."""
    a, b = float(np.linalg.norm(r1)), float(np.linalg.norm(r2))
    cosine = float(np.clip(np.dot(r1, r2) / (a * b), -1, 1))
    sine = math.sqrt(1 - cosine**2) * float(np.sign(np.dot(np.cross(r1, r2), normal)))
    coefficient = sine * math.sqrt(a * b / (1 - cosine))

    def time_of_flight(z: float) -> float:
        c, s = _stumpff(z)
        y = a + b + coefficient * (z * s - 1) / math.sqrt(c)
        if y <= 0:
            return math.nan
        return ((y / c) ** 1.5 * s + coefficient * math.sqrt(y)) / math.sqrt(MU_E)

    grid = np.linspace(-4 * math.pi**2 + 1e-5, 4 * math.pi**2 - 1e-5, 200)
    previous: tuple[float, float] | None = None
    bracket: tuple[float, float] | None = None
    for value in grid:
        z = float(value)
        residual = time_of_flight(z) - duration
        if not math.isfinite(residual):
            continue
        if previous and previous[1] * residual <= 0:
            bracket = previous[0], z
            break
        previous = z, residual
    if bracket is None:
        raise ValueError("No direct-transfer Lambert solution for this interval")
    z = float(brentq(lambda z: time_of_flight(z) - duration, *bracket))
    c, s = _stumpff(z)
    y = a + b + coefficient * (z * s - 1) / math.sqrt(c)
    return np.asarray((r2 - (1 - y / a) * r1) / (coefficient * math.sqrt(y / MU_E)))


@dataclass(frozen=True)
class LandingApproach:
    latitude: float
    longitude: float
    duration_s: float
    downrange_m: float = 240_000.0

    def capture_direction(self, up: Vec, incoming: Vec, radius_km: float, arrival: datetime) -> Vec:
        """Fit a circular capture plane through perilune and the future surface target."""
        lat, lon = math.radians(self.latitude), math.radians(self.longitude)
        fixed = np.array(
            [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)]
        )
        motion = math.sqrt(MU_M / radius_km**3)
        semimajor = (radius_km + R_M + 15.0) / 2
        coast_s = math.pi * math.sqrt(semimajor**3 / MU_M)
        epoch = arrival
        for _ in range(12):
            target = moon_fixed_direction_to_j2000(fixed, epoch)
            tangent = target - float(np.dot(target, up)) * up
            length = float(np.linalg.norm(tangent))
            if length < 1e-10:
                tangent = incoming.copy()
            else:
                tangent /= length
            if np.dot(tangent, incoming) < 0:
                tangent = -tangent
            angle = math.atan2(float(np.dot(target, tangent)), float(np.dot(target, up)))
            burn_phase = (angle - self.downrange_m / (R_M * 1000) - math.pi) % math.tau
            updated = arrival + timedelta(seconds=burn_phase / motion + coast_s + self.duration_s)
            if abs((updated - epoch).total_seconds()) < 0.001:
                return tangent
            epoch = updated
        raise ValueError("Site-targeted capture geometry did not converge")


def calculate_transfer(
    departure: datetime,
    arrival: datetime,
    data_dir: Path,
    *,
    landing_approach: LandingApproach | None = None,
) -> TransferResult:
    """Fit a direct transfer to exact UTC endpoints or raise ValueError; no fixture fallback."""
    if departure.tzinfo is None or arrival.tzinfo is None:
        raise ValueError("Dates must include a timezone")
    calendar_seconds = (arrival - departure).total_seconds()
    if not 86400 <= calendar_seconds <= 10 * 86400:
        raise ValueError("Direct-transfer preview supports flight times of 1 to 10 days")
    if not (1900 <= departure.year <= 2100 and 1900 <= arrival.year <= 2100):
        raise ValueError("Dates must fall between 1900 and 2100")
    load_kernels(data_dir / "spice")
    departure_et = ephemeris_time(departure)
    duration = ephemeris_time(arrival) - departure_et
    grid = np.linspace(0, duration + POST_SECONDS, math.ceil((duration + POST_SECONDS) / 1800) + 1)
    ephemeris = moon_states(departure, grid)
    moon = CubicHermiteSpline(grid, ephemeris[:, :3], ephemeris[:, 3:])
    end = np.asarray(moon(duration), dtype=np.float64)
    end_velocity = np.asarray(moon(duration, 1), dtype=np.float64)
    radial = end / np.linalg.norm(end)
    normal = np.cross(end, end_velocity)
    normal /= np.linalg.norm(normal)
    tangent = np.cross(normal, radial)
    seed_target = end - (R_M + ARRIVAL_HEIGHT) * radial
    deadline = monotonic() + 20

    def rhs(t: float, state: Vec, weight: float = 1.0) -> Vec:
        if monotonic() > deadline:
            raise ValueError("Transfer did not converge in time; try another date pair")
        r = state[:3]
        m = np.asarray(moon(t), dtype=np.float64)
        delta = r - m
        acceleration = -MU_E * r / max(float(np.linalg.norm(r)), 1.0) ** 3
        acceleration -= (
            weight
            * MU_M
            * (
                delta / max(float(np.linalg.norm(delta)), 1.0) ** 3
                + m / float(np.linalg.norm(m)) ** 3
            )
        )
        return np.concatenate((state[3:], acceleration))

    class ClearanceEvent:
        terminal = True
        direction = -1

        def __call__(self, t: float, state: Vec) -> float:
            earth = float(np.linalg.norm(state[:3])) - R_E - 100
            lunar = float(np.linalg.norm(state[:3] - moon(t))) - R_M
            return min(earth, lunar)

    # The parking plane follows lunar orbital angular momentum, not a fixed
    # launch site. Try two direct-transfer orientations; never draw an unfitted seed.
    angles = (160.0, 140.0)
    t_pre = np.unique(
        np.r_[
            np.linspace(0, duration, 650),
            np.linspace(duration - 3 * 3600, duration, 160),
            np.linspace(duration - 600, duration, 121),
        ]
    )
    for angle in angles:
        radians = math.radians(angle)
        r0 = (R_E + PARKING) * (math.cos(radians) * radial - math.sin(radians) * tangent)
        initial = _lambert(r0, seed_target, duration, normal)

        # DOP853 controls local error and shortens steps near either body. A
        # two-hour cruise ceiling avoids hundreds of unnecessary far-field steps
        # per shooting iteration; final propagation uses the same settings.
        def propagate(velocity: Vec, weight: float, origin: Vec = r0) -> Vec:
            solution = solve_ivp(
                rhs,
                (0, duration),
                np.r_[origin, velocity],
                args=(weight,),
                method="DOP853",
                rtol=2e-9,
                atol=1e-9,
                max_step=7200,
            )
            if not solution.success:
                raise ValueError("Numerical propagation failed")
            return np.asarray(solution.y[:, -1], dtype=np.float64)

        velocity = initial
        converged = True

        def residual(v: Vec, gravity: float) -> Vec:
            return (propagate(v, gravity)[:3] - seed_target) / 1000

        for weight in (0.25, 0.5, 0.75, 1.0):
            fitted = root(
                residual,
                velocity,
                args=(weight,),
                options={"eps": 1e-10, "xtol": 1e-8, "maxfev": 60},
            )
            velocity = np.asarray(fitted.x, dtype=np.float64)
            if np.linalg.norm(propagate(velocity, weight)[:3] - seed_target) > 0.03:
                converged = False
                break
        if not converged:
            continue

        # Keep the dates fixed and free one arrival-position angle. Three departure
        # velocity components plus that angle satisfy position (3) and radial
        # velocity (1). Continuation from the fitted near-side point avoids a
        # discontinuous jump to another encounter branch.
        seed_state = propagate(velocity, 1.0)
        seed_r = seed_state[:3] - end
        seed_radial_speed = float(
            np.dot(seed_state[3:] - end_velocity, seed_r) / np.linalg.norm(seed_r)
        )
        parameters = np.r_[velocity, 0.0]

        def arrival_position(angle: float) -> Vec:
            return end + (R_M + ARRIVAL_HEIGHT) * (
                -math.cos(angle) * radial + math.sin(angle) * tangent
            )

        def perilune_residual(parameters: Vec, radial_speed: float) -> Vec:
            state = propagate(parameters[:3], 1.0)
            relative_r = state[:3] - end
            actual_radial_speed = float(
                np.dot(state[3:] - end_velocity, relative_r) / np.linalg.norm(relative_r)
            )
            return np.r_[
                (state[:3] - arrival_position(float(parameters[3]))) / 1000,
                actual_radial_speed - radial_speed,
            ]

        for fraction in (0.25, 0.5, 0.75, 1.0):
            goal_speed = seed_radial_speed * (1 - fraction)
            fitted = root(
                perilune_residual,
                parameters,
                args=(goal_speed,),
                options={"eps": 1e-10, "xtol": 1e-9, "maxfev": 80},
            )
            parameters = np.asarray(fitted.x, dtype=np.float64)
            residuals = perilune_residual(parameters, goal_speed)
            if np.linalg.norm(residuals[:3]) > 0.00003 or abs(residuals[3]) > 1e-5:
                converged = False
                break
        if not converged:
            continue
        velocity = parameters[:3]
        target = arrival_position(float(parameters[3]))
        pre = solve_ivp(
            rhs,
            (0, duration),
            np.r_[r0, velocity],
            t_eval=t_pre,
            events=ClearanceEvent(),
            method="DOP853",
            rtol=2e-9,
            atol=1e-9,
            max_step=7200,
        )
        if not pre.success or len(pre.t) != len(t_pre):
            continue
        moon_pre = np.asarray(moon(t_pre), dtype=np.float64)
        error = float(np.linalg.norm(pre.y[:3, -1] - target))
        earth_clearance = float(np.linalg.norm(pre.y[:3], axis=0).min() - R_E)
        lunar_clearance = float(np.linalg.norm(pre.y[:3].T - moon_pre, axis=1).min() - R_M)
        relative_r = pre.y[:3, -1] - end
        relative_v = pre.y[3:, -1] - end_velocity
        radius = float(np.linalg.norm(relative_r))
        up = relative_r / radius
        radial_speed = float(np.dot(relative_v, up))
        relative_acceleration = rhs(duration, np.asarray(pre.y[:, -1]))[3:] - moon(duration, 2)
        radial_acceleration = float(
            (np.dot(relative_v, relative_v) - radial_speed**2) / radius
            + np.dot(up, relative_acceleration)
        )
        # Zero radial speed alone could select an apolune. Require a minimum
        # distance with an inbound approach and no earlier, lower lunar passage.
        previous_r = np.asarray(pre.y[:3, -2] - moon_pre[-2], dtype=np.float64)
        approaching = float(np.linalg.norm(previous_r)) > radius
        if (
            error > 0.05
            or earth_clearance < 100
            or lunar_clearance < ARRIVAL_HEIGHT - 0.05
            or abs(radial_speed) > 1e-5
            or radial_acceleration <= 0
            or not approaching
        ):
            continue
        break
    else:
        raise ValueError("No collision-free direct transfer converged; try another date pair")

    state = np.asarray(pre.y[:, -1], dtype=np.float64)
    relative_r = state[:3] - end
    relative_v = state[3:] - end_velocity
    up = relative_r / np.linalg.norm(relative_r)
    direction = np.asarray(relative_v - np.dot(relative_v, up) * up, dtype=np.float64)
    direction = np.asarray(direction / float(np.linalg.norm(direction)), dtype=np.float64)
    if landing_approach is not None:
        direction = landing_approach.capture_direction(
            up, direction, float(np.linalg.norm(relative_r)), arrival
        )
    captured_velocity = (
        end_velocity + math.sqrt(MU_M / float(np.linalg.norm(relative_r))) * direction
    )
    loi = float(np.linalg.norm(captured_velocity - state[3:]))
    captured_state = np.r_[state[:3], captured_velocity]

    # Preserve exact impulsive-burn boundary conditions, not finite differences
    # of sparse public OrbitSample positions. The Moon-centered inertial state
    # is the orbit integrator's interpolated Moon J2000 state at arrival.
    pre_moon_j2000 = np.r_[state[:3] - end, state[3:] - end_velocity]
    post_moon_j2000 = np.r_[captured_state[:3] - end, captured_state[3:] - end_velocity]
    pre_moon_si = pre_moon_j2000 * 1000.0
    post_moon_si = post_moon_j2000 * 1000.0
    loi_handoff = LoiHandoff(
        epoch_utc=arrival,
        center="MOON",
        inertial_frame="J2000",
        fixed_frame="MOON_ME",
        pre_loi_j2000_km_kmps=pre_moon_j2000.tolist(),
        post_loi_j2000_km_kmps=post_moon_j2000.tolist(),
        pre_loi_moon_me_m_mps=inertial_moon_state_to_moon_me(pre_moon_si, arrival).tolist(),
        post_loi_moon_me_m_mps=inertial_moon_state_to_moon_me(post_moon_si, arrival).tolist(),
    )
    t_post = np.unique(
        np.r_[
            np.linspace(duration, duration + POST_SECONDS, 420),
            np.linspace(duration, duration + 600, 121),
        ]
    )
    post = solve_ivp(
        rhs,
        (duration, duration + POST_SECONDS),
        captured_state,
        t_eval=t_post,
        method="DOP853",
        rtol=2e-9,
        atol=1e-9,
        max_step=140,
    )
    if not post.success:
        raise ValueError("Lunar capture propagation failed")
    moon_post = np.asarray(moon(t_post), dtype=np.float64)
    min_altitude = float(np.linalg.norm(post.y[:3].T - moon_post, axis=1).min() - R_M)
    if min_altitude <= 0:
        raise ValueError("Computed capture intersects the lunar surface")
    parking_velocity = math.sqrt(MU_E / (R_E + PARKING)) * np.cross(normal, r0 / (R_E + PARKING))
    tli = float(np.linalg.norm(velocity - parking_velocity))

    def samples(times: Vec, positions: Vec, moons: Vec) -> list[OrbitSample]:
        return [
            OrbitSample(float(t), p.tolist(), m.tolist())
            for t, p, m in zip(
                elapsed_si_seconds(departure_et, times), positions, moons, strict=True
            )
        ]

    return TransferResult(
        departure,
        arrival,
        "DE440 J2000 Earth-Moon gravity; Lambert seed + perilune shooting",
        R_E,
        R_M,
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        up.tolist(),
        direction.tolist(),
        TransferMetrics(
            calendar_seconds / 86400,
            PARKING,
            float(np.linalg.norm(relative_r) - R_M),
            error,
            tli,
            loi,
            tli + loi,
            min_altitude,
        ),
        samples(t_pre, np.asarray(pre.y[:3].T), moon_pre),
        samples(t_post, np.asarray(post.y[:3].T), moon_post),
        moon_states(departure, np.linspace(0, 29 * 86400, 240))[:, :3].tolist(),
        loi_handoff,
    )
