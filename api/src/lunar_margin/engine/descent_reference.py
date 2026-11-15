"""Preliminary lunar powered-descent reference trajectory and DEM feasibility.

Moon-fixed MOON_ME position and velocity are in SI units. Rotation is modeled
as constant over the short descent. This is an inverse-dynamics reference
profile search, NOT a flight-certified guidance law or global optimum.
"""

import math
from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np
from numpy.typing import NDArray

Vec = NDArray[np.float64]
MU_M = 4.902800066e12
R_M = 1_737_400.0
OMEGA = 2 * math.pi / (27.321661 * 86400.0)
G0 = 9.80665
PathStatus = Literal[
    "REFERENCE_FEASIBLE",
    "TERRAIN_COLLISION",
    "TERRAIN_UNKNOWN",
    "ENGINE_LIMIT",
    "FUEL_LIMIT",
]


class Terrain(Protocol):
    def sample_height_lonlat_m(self, lat_deg: Vec, lon_deg: Vec) -> Vec: ...


@dataclass(frozen=True)
class Lander:
    wet_mass_kg: float = 1200.0
    dry_mass_kg: float = 450.0
    max_thrust_n: float = 15000.0
    min_thrust_n: float = 0.0
    isp_s: float = 310.0

    def __post_init__(self) -> None:
        values = (
            self.wet_mass_kg,
            self.dry_mass_kg,
            self.max_thrust_n,
            self.min_thrust_n,
            self.isp_s,
        )
        if not all(math.isfinite(v) for v in values):
            raise ValueError("lander parameters must be finite")
        if not (self.wet_mass_kg > self.dry_mass_kg > 0):
            raise ValueError("wet mass must exceed positive dry mass")
        if not (0 <= self.min_thrust_n < self.max_thrust_n):
            raise ValueError("thrust limits invalid")
        if self.isp_s <= 0:
            raise ValueError("Isp must be positive")


@dataclass(frozen=True)
class PdiState:
    position_m: Vec
    velocity_mps: Vec
    doi_delta_v_mps: float
    doi_to_pdi_s: float
    approach_range_km: float


@dataclass(frozen=True)
class FlightSample:
    t_s: float
    lat_deg: float
    lon_deg: float
    altitude_agl_m: float | None
    speed_mps: float
    thrust_n: float
    mass_kg: float
    moon_me_xyz_m: list[float]


@dataclass(frozen=True)
class PathResult:
    status: PathStatus
    duration_s: float
    loft_m: float
    propellant_kg: float | None
    min_clearance_m: float | None
    max_thrust_n: float | None
    min_thrust_n: float | None
    samples: list[FlightSample]

    @property
    def feasible(self) -> bool:
        return self.status == "REFERENCE_FEASIBLE"


def surface_vector(lat_deg: float, lon_deg: float) -> Vec:
    phi, lam = math.radians(lat_deg), math.radians(lon_deg)
    return np.array(
        [math.cos(phi) * math.cos(lam), math.cos(phi) * math.sin(lam), math.sin(phi)]
    )


def pdi_from_target(
    lat_deg: float,
    lon_deg: float,
    *,
    approach_azimuth_deg: float = 90.0,
    approach_range_km: float = 300.0,
) -> PdiState:
    """Reference 100x15-km DOI/PDI geometry from a prescribed approach heading.

    Does not claim to match the dated Earth-Moon transfer or a mission's actual
    orbital-plane and separation constraints.
    """
    values = (lat_deg, lon_deg, approach_azimuth_deg, approach_range_km)
    if not all(math.isfinite(v) for v in values):
        raise ValueError("PDI parameters must be finite")
    if not (-90 <= lat_deg <= -80) or not (0 < approach_range_km < 600):
        raise ValueError("south-polar latitude or approach range invalid")
    up = surface_vector(lat_deg, lon_deg)
    lon = math.radians(lon_deg)
    az = math.radians(approach_azimuth_deg)
    east = np.array([-math.sin(lon), math.cos(lon), 0.0])
    north = np.cross(up, east)
    direction = north * math.cos(az) + east * math.sin(az)
    angle = approach_range_km * 1000 / R_M
    pdi_up = up * math.cos(angle) - direction * math.sin(angle)
    towards_target = up - pdi_up * float(np.dot(pdi_up, up))
    towards_target /= np.linalg.norm(towards_target)
    apoapsis, periapsis = R_M + 100_000, R_M + 15_000
    semimajor = (apoapsis + periapsis) / 2
    circular_speed = math.sqrt(MU_M / apoapsis)
    apoapsis_speed = math.sqrt(MU_M * (2 / apoapsis - 1 / semimajor))
    periapsis_speed = math.sqrt(MU_M * (2 / periapsis - 1 / semimajor))
    doi_time = math.pi * math.sqrt(semimajor**3 / MU_M)
    rotation_velocity = np.cross(np.array([0.0, 0.0, OMEGA]), periapsis * pdi_up)
    return PdiState(
        periapsis * pdi_up,
        periapsis_speed * towards_target - rotation_velocity,
        circular_speed - apoapsis_speed,
        doi_time,
        approach_range_km,
    )


def _trajectory_at_times(
    pdi: PdiState,
    target: Vec,
    duration_s: float,
    loft_m: float,
    t: Vec,
) -> tuple[Vec, Vec, Vec]:
    """Analytic quintic trajectory and derivatives in the rotating lunar frame."""
    s = t / duration_s
    p0, v0 = pdi.position_m, pdi.velocity_mps
    delta = target - p0
    c3 = 10 * delta - 6 * v0 * duration_s
    c4 = -15 * delta + 8 * v0 * duration_s
    c5 = 6 * delta - 3 * v0 * duration_s
    s2, s3, s4, s5 = s**2, s**3, s**4, s**5
    up = target / np.linalg.norm(target)
    bump = 16 * (s2 - 2 * s3 + s4)
    bump_d = (32 * s - 96 * s2 + 64 * s3) / duration_s
    bump_dd = (32 - 192 * s + 192 * s2) / duration_s**2
    position = (
        p0[None, :]
        + v0[None, :] * t[:, None]
        + c3[None, :] * s3[:, None]
        + c4[None, :] * s4[:, None]
        + c5[None, :] * s5[:, None]
        + loft_m * bump[:, None] * up[None, :]
    )
    velocity = (
        v0[None, :]
        + (
            3 * c3[None, :] * s2[:, None]
            + 4 * c4[None, :] * s3[:, None]
            + 5 * c5[None, :] * s4[:, None]
        )
        / duration_s
        + loft_m * bump_d[:, None] * up[None, :]
    )
    acceleration = (
        (
            6 * c3[None, :] * s[:, None]
            + 12 * c4[None, :] * s2[:, None]
            + 20 * c5[None, :] * s3[:, None]
        )
        / duration_s**2
        + loft_m * bump_dd[:, None] * up[None, :]
    )
    return position, velocity, acceleration


def _moon_lat_lon(position: Vec) -> tuple[Vec, Vec, Vec]:
    radius = np.linalg.norm(position, axis=1)
    lat = np.degrees(np.arcsin(np.clip(position[:, 2] / radius, -1, 1)))
    lon = np.degrees(np.arctan2(position[:, 1], position[:, 0]))
    return radius, lat, lon


def evaluate_reference(
    dem: Terrain,
    pdi: PdiState,
    lat_deg: float,
    lon_deg: float,
    lander: Lander,
    *,
    duration_s: float,
    loft_m: float = 0.0,
    clearance_m: float = 50.0,
) -> PathResult:
    """Screen a *specific* reference profile; feasibility is not globally proven."""
    values = (lat_deg, lon_deg, duration_s, loft_m, clearance_m)
    if not all(math.isfinite(v) for v in values):
        raise ValueError("trajectory parameters must be finite")
    if not (60 <= duration_s <= 3600) or not (0 <= loft_m <= 30_000):
        raise ValueError("duration or loft invalid")
    if clearance_m < 0:
        raise ValueError("clearance must not be negative")
    lat = np.array([lat_deg], dtype=np.float64)
    lon = np.array([lon_deg], dtype=np.float64)
    height = float(dem.sample_height_lonlat_m(lat, lon)[0])
    if not math.isfinite(height):
        return PathResult("TERRAIN_UNKNOWN", duration_s, loft_m, None, None, None, None, [])
    target = (R_M + height) * surface_vector(lat_deg, lon_deg)

    # Inverse-dynamics/propellant grid. Do not use the sparse guidance grid
    # for collision checks; the spacecraft travels kilometers in five seconds.
    t = np.linspace(0, duration_s, max(41, math.ceil(duration_s / 5) + 1))
    r, v, a = _trajectory_at_times(pdi, target, duration_s, loft_m, t)
    radius, phi, lam = _moon_lat_lon(r)
    altitude = radius - R_M - dem.sample_height_lonlat_m(phi, lam)

    # Dense DEM samples (<40 m nominal movement near PDI) prevent small ridges
    # disappearing between sparse guidance knots. This does not certify
    # sub-pixel hazards or prove continuous-time collision avoidance.
    initial_speed = float(np.linalg.norm(pdi.velocity_mps))
    terrain_dt = min(0.2, 40.0 / max(1.0, initial_speed))
    dense_t = np.linspace(0, duration_s, math.ceil(duration_s / terrain_dt) + 1)
    dense_r, _, _ = _trajectory_at_times(pdi, target, duration_s, loft_m, dense_t)
    dense_radius, dense_phi, dense_lam = _moon_lat_lon(dense_r)
    dense_agl = dense_radius - R_M - dem.sample_height_lonlat_m(dense_phi, dense_lam)

    # Rotating frame: r'' = gravity + thrust/m - 2 omega x v
    #                                   - omega x (omega x r).
    omega = np.array([0.0, 0.0, OMEGA])
    gravity = -MU_M * r / radius[:, None] ** 3
    thrust_acc = a - gravity + 2 * np.cross(omega, v) + np.cross(omega, np.cross(omega, r))
    acceleration_mag = np.linalg.norm(thrust_acc, axis=1)
    dt = np.diff(t)
    integrated_acc = np.r_[
        0.0,
        np.cumsum((acceleration_mag[1:] + acceleration_mag[:-1]) * dt / 2),
    ]
    # Exact mass relation for specified acceleration history and constant Isp.
    mass = lander.wet_mass_kg * np.exp(-integrated_acc / (lander.isp_s * G0))
    thrust = mass * acceleration_mag
    propellant = float(lander.wet_mass_kg - mass[-1])
    min_agl = (
        float(np.min(dense_agl[np.isfinite(dense_agl)]))
        if np.isfinite(dense_agl).any()
        else None
    )
    peak = float(np.max(thrust))
    low = float(np.min(thrust))

    if not np.isfinite(dense_agl).all():
        status: PathStatus = "TERRAIN_UNKNOWN"
    elif np.any(dense_agl[:-1] < -0.001) or dense_agl[-1] < -0.001:
        status = "TERRAIN_COLLISION"
    elif np.any((dense_t[:-1] < duration_s - 30) & (dense_agl[:-1] < clearance_m)):
        status = "TERRAIN_COLLISION"
    elif mass[-1] < lander.dry_mass_kg:
        status = "FUEL_LIMIT"
    elif peak > lander.max_thrust_n or low < lander.min_thrust_n:
        status = "ENGINE_LIMIT"
    else:
        status = "REFERENCE_FEASIBLE"

    indices = list(range(0, len(t), max(1, len(t) // 35)))
    if indices[-1] != len(t) - 1:
        indices.append(len(t) - 1)
    samples = [
        FlightSample(
            t_s=round(float(t[i]), 2),
            lat_deg=round(float(phi[i]), 7),
            lon_deg=round(float(lam[i]), 7),
            altitude_agl_m=round(float(altitude[i]), 2)
            if math.isfinite(float(altitude[i]))
            else None,
            speed_mps=round(float(np.linalg.norm(v[i])), 2),
            thrust_n=round(float(thrust[i]), 2),
            mass_kg=round(float(mass[i]), 3),
            moon_me_xyz_m=[round(float(value), 2) for value in r[i]],
        )
        for i in indices
    ]
    return PathResult(
        status, duration_s, loft_m, propellant, min_agl, peak, low, samples
    )


def evaluate_alternatives(
    dem: Terrain,
    pdi: PdiState,
    targets: list[tuple[float, float]],
    lander: Lander,
    *,
    clearance_m: float = 50.0,
) -> list[PathResult]:
    """Compare a limited library of profiles from the *same* initial PDI state.

    A failure means NO PROFILE FOUND in this discrete search, not that the
    target is physically unreachable by every feasible control trajectory.
    """
    if not 1 <= len(targets) <= 4:
        raise ValueError("one to four landing targets required")
    durations = (480.0, 600.0, 720.0, 840.0, 960.0)
    lofts = (0.0, 2000.0, 6000.0)
    results: list[PathResult] = []
    for lat, lon in targets:
        options = [
            evaluate_reference(
                dem,
                pdi,
                lat,
                lon,
                lander,
                duration_s=duration,
                loft_m=loft,
                clearance_m=clearance_m,
            )
            for duration in durations
            for loft in lofts
        ]
        feasible = [item for item in options if item.feasible]
        if feasible:
            results.append(min(feasible, key=lambda item: float(item.propellant_kg or 0)))
        else:
            priority = {
                "TERRAIN_UNKNOWN": 0,
                "FUEL_LIMIT": 1,
                "ENGINE_LIMIT": 2,
                "TERRAIN_COLLISION": 3,
                "REFERENCE_FEASIBLE": 4,
            }
            results.append(
                min(
                    options,
                    key=lambda item: (
                        priority[item.status],
                        item.propellant_kg if item.propellant_kg is not None else math.inf,
                    ),
                )
            )
    return results
