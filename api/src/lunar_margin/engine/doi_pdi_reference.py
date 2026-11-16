"""Two-body LOI-to-DOI-to-PDI reference with site-alignment screening.

Consumes a PHYSICAL Moon-centered J2000 post-LOI state (6D) from the existing
transfer solver. Does not claim a landing, an optimized orbit, or maneuverability
across orbital planes. Output samples are time-tagged for later visualization.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize_scalar

Vec = NDArray[np.float64]
MU_M = 4.902800066e12  # m^3/s^2
R_M = 1_737_400.0  # m

FrameTransform = Callable[[Vec, datetime], Vec]
Status = Literal["REFERENCE_ALIGNED", "NO_ALIGNED_REFERENCE"]


@dataclass(frozen=True)
class PhaseState:
    epoch_utc: datetime
    phase: Literal["LOI", "DOI_PRE", "DOI_POST", "PDI"]
    j2000_m_mps: list[float]
    moon_me_m_mps: list[float]


@dataclass(frozen=True)
class TrajectorySample:
    epoch_utc: datetime
    phase: Literal["PARKING_COAST", "DOI_COAST"]
    moon_me_xyz_m: list[float]
    j2000_xyz_m: list[float]
    altitude_reference_m: float


@dataclass(frozen=True)
class DoiPdiReference:
    model: str
    status: Status
    target_lat_deg: float
    target_lon_deg: float
    approach_error_m: float
    plane_offset_m: float
    tolerance_m: float
    parking_altitude_m: float
    pdi_altitude_m: float
    parking_period_s: float
    coast_time_s: float
    doi_delta_v_mps: float
    loi: PhaseState
    doi_pre: PhaseState
    doi_post: PhaseState
    pdi: PhaseState
    aligned_pdi_moon_me_m_mps: list[float] | None
    samples: list[TrajectorySample]


def _unit(vector: Vec) -> Vec:
    length = float(np.linalg.norm(vector))
    if not math.isfinite(length) or length == 0:
        raise ValueError("zero or non-finite direction")
    return vector / length


def _site_unit(lat_deg: float, lon_deg: float) -> Vec:
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    return np.array(
        [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)],
        dtype=np.float64,
    )


def _angle(a: Vec, b: Vec) -> float:
    return math.acos(float(np.clip(np.dot(_unit(a), _unit(b)), -1.0, 1.0)))


def reference_doi_pdi(
    post_loi_j2000_m_mps: Vec,
    loi_epoch_utc: datetime,
    target_lat_deg: float,
    target_lon_deg: float,
    frame_transform: FrameTransform,
    *,
    pdi_altitude_m: float = 15_000.0,
    tolerance_m: float = 5_000.0,
    phase_grid_count: int = 72,
) -> DoiPdiReference:
    """Search a parking-orbit burn PHASE for one site-aligned PDI reference.

    Assumes the supplied post-LOI state is nearly circular and tangential.
    Searches up to one two-body parking revolution, applies a tangential DOI
    lowering perilune to the given altitude, then coasts half an ellipse.
    The target site moves under the exact epoch-specific SPICE frame rotation.
    A non-aligned result is not a proof of physical unreachability.
    """
    state = np.asarray(post_loi_j2000_m_mps, dtype=np.float64)
    if state.shape != (6,) or not np.isfinite(state).all():
        raise ValueError("post-LOI state must have six finite SI numbers")
    if loi_epoch_utc.tzinfo is None:
        raise ValueError("LOI epoch must include timezone")
    if not (
        math.isfinite(target_lat_deg)
        and -90.0 <= target_lat_deg <= -80.0
        and math.isfinite(target_lon_deg)
        and math.isfinite(pdi_altitude_m)
        and 0 < pdi_altitude_m < 100_000
        and math.isfinite(tolerance_m)
        and 0 < tolerance_m <= 100_000
        and 24 <= phase_grid_count <= 360
    ):
        raise ValueError("invalid site, DOI/PDI altitude, tolerance or phase grid")

    position = state[:3]
    velocity = state[3:]
    radius = float(np.linalg.norm(position))
    r_hat = _unit(position)
    if not (R_M + pdi_altitude_m + 1000 < radius < R_M + 200_000):
        raise ValueError("post-LOI parking altitude must exceed PDI and remain below 200 km")
    circular_speed = math.sqrt(MU_M / radius)
    radial_speed = float(np.dot(velocity, r_hat))
    if abs(radial_speed) > 1.0 or abs(float(np.linalg.norm(velocity)) - circular_speed) > 1.0:
        raise ValueError("post-LOI state is not a near-circular tangential parking orbit")
    h_hat = _unit(np.cross(position, velocity))
    tangent = _unit(np.cross(h_hat, r_hat))
    mean_motion = math.sqrt(MU_M / radius**3)
    period_s = 2 * math.pi / mean_motion
    rp = R_M + pdi_altitude_m
    semimajor = (radius + rp) / 2
    ecc = (radius - rp) / (radius + rp)
    ellipse_motion = math.sqrt(MU_M / semimajor**3)
    coast_time_s = math.pi / ellipse_motion
    doi_speed = math.sqrt(MU_M * (2 / radius - 1 / semimajor))
    peri_speed = math.sqrt(MU_M * (2 / rp - 1 / semimajor))
    doi_dv = circular_speed - doi_speed
    target = _site_unit(target_lat_deg, target_lon_deg)

    def orbit_at(phase: float) -> tuple[Vec, Vec, Vec, Vec, datetime]:
        unit_r = math.cos(phase) * r_hat + math.sin(phase) * tangent
        unit_t = -math.sin(phase) * r_hat + math.cos(phase) * tangent
        burn_r = radius * unit_r
        after_doi_v = doi_speed * unit_t
        pdi_epoch = loi_epoch_utc + timedelta(seconds=phase / mean_motion + coast_time_s)
        pdi_r = -rp * unit_r
        pdi_v = -peri_speed * unit_t
        return burn_r, after_doi_v, pdi_r, pdi_v, pdi_epoch

    def misalignment(phase: float) -> float:
        _, _, pdi_r, pdi_v, pdi_epoch = orbit_at(phase)
        fixed = np.asarray(frame_transform(np.r_[pdi_r, pdi_v], pdi_epoch), dtype=np.float64)
        if fixed.shape != (6,) or not np.isfinite(fixed).all():
            raise ValueError("frame transform returned invalid 6D state")
        return R_M * _angle(fixed[:3], target)

    phases = np.linspace(0.0, 2 * math.pi, phase_grid_count + 1)
    errors = np.array([misalignment(float(phase)) for phase in phases])
    index = int(np.argmin(errors))
    best_phase = float(phases[index])
    if 0 < index < len(phases) - 1:
        refined = minimize_scalar(
            misalignment,
            bounds=(float(phases[index - 1]), float(phases[index + 1])),
            method="bounded",
            options={"xatol": 1e-9},
        )
        if refined.success and refined.fun < errors[index]:
            best_phase = float(refined.x)

    burn_r, after_doi_v, pdi_r, pdi_v, pdi_epoch = orbit_at(best_phase)
    burn_tangent = _unit(np.cross(h_hat, burn_r))
    pre_doi_v = circular_speed * burn_tangent
    doi_epoch = loi_epoch_utc + timedelta(seconds=best_phase / mean_motion)
    closest_distance = misalignment(best_phase)
    pdi_fixed = np.asarray(frame_transform(np.r_[pdi_r, pdi_v], pdi_epoch), dtype=np.float64)
    fixed_plane_normal = np.asarray(
        frame_transform(np.r_[h_hat, np.zeros(3)], pdi_epoch), dtype=np.float64
    )[:3]
    plane_offset_m = R_M * math.asin(
        min(1.0, abs(float(np.dot(_unit(fixed_plane_normal), target))))
    )
    status: Status = (
        "REFERENCE_ALIGNED" if closest_distance <= tolerance_m else "NO_ALIGNED_REFERENCE"
    )

    def phase_state(
        epoch: datetime,
        phase: Literal["LOI", "DOI_PRE", "DOI_POST", "PDI"],
        s: Vec,
    ) -> PhaseState:
        fixed_state = np.asarray(frame_transform(s, epoch), dtype=np.float64)
        return PhaseState(epoch, phase, s.tolist(), fixed_state.tolist())

    initial = phase_state(loi_epoch_utc, "LOI", state)
    doi_pre = phase_state(doi_epoch, "DOI_PRE", np.r_[burn_r, pre_doi_v])
    doi_post = phase_state(doi_epoch, "DOI_POST", np.r_[burn_r, after_doi_v])
    pdi = phase_state(pdi_epoch, "PDI", np.r_[pdi_r, pdi_v])

    samples: list[TrajectorySample] = []

    def add_sample(
        epoch: datetime,
        segment: Literal["PARKING_COAST", "DOI_COAST"],
        r: Vec,
        v: Vec,
    ) -> None:
        fixed_state = np.asarray(frame_transform(np.r_[r, v], epoch), dtype=np.float64)
        samples.append(
            TrajectorySample(
                epoch,
                segment,
                fixed_state[:3].tolist(),
                r.tolist(),
                float(np.linalg.norm(r) - R_M),
            )
        )

    # Physically time-tagged circular parking arc from the true LOI state.
    if best_phase > 1e-12:
        for fraction in np.linspace(0.0, 1.0, 17):
            angle = best_phase * float(fraction)
            arc_r = radius * (math.cos(angle) * r_hat + math.sin(angle) * tangent)
            arc_t = -math.sin(angle) * r_hat + math.cos(angle) * tangent
            epoch = loi_epoch_utc + timedelta(seconds=angle / mean_motion)
            add_sample(epoch, "PARKING_COAST", arc_r, circular_speed * arc_t)

    # Exact two-body Kepler ellipse samples via eccentric anomaly.
    # E=pi is DOI at apolune; E=2pi is the 15-km perilune/PDI.
    p_hat = -_unit(burn_r)
    q_hat = -burn_tangent
    semilatus = semimajor * (1 - ecc**2)
    for e_anom in np.linspace(math.pi, 2 * math.pi, 65):
        cos_e, sin_e = math.cos(float(e_anom)), math.sin(float(e_anom))
        radius_e = semimajor * (1 - ecc * cos_e)
        cos_f = (cos_e - ecc) / (1 - ecc * cos_e)
        sin_f = math.sqrt(1 - ecc**2) * sin_e / (1 - ecc * cos_e)
        point_r = radius_e * (cos_f * p_hat + sin_f * q_hat)
        point_v = math.sqrt(MU_M / semilatus) * (-sin_f * p_hat + (ecc + cos_f) * q_hat)
        elapsed_s = (float(e_anom) - ecc * sin_e - math.pi) / ellipse_motion
        sample_epoch = doi_epoch + timedelta(seconds=elapsed_s)
        add_sample(sample_epoch, "DOI_COAST", point_r, point_v)

    return DoiPdiReference(
        model="TWO_BODY_REFERENCE_NO_MISSION_FEASIBILITY",
        status=status,
        target_lat_deg=target_lat_deg,
        target_lon_deg=target_lon_deg,
        approach_error_m=closest_distance,
        plane_offset_m=plane_offset_m,
        tolerance_m=tolerance_m,
        parking_altitude_m=radius - R_M,
        pdi_altitude_m=pdi_altitude_m,
        parking_period_s=period_s,
        coast_time_s=coast_time_s,
        doi_delta_v_mps=doi_dv,
        loi=initial,
        doi_pre=doi_pre,
        doi_post=doi_post,
        pdi=pdi,
        aligned_pdi_moon_me_m_mps=pdi_fixed.tolist() if status == "REFERENCE_ALIGNED" else None,
        samples=samples,
    )
