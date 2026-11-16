"""Synthetic geometry checks for the LOI -> DOI -> PDI orbital reference."""

from datetime import UTC, datetime

import numpy as np
import pytest

from lunar_margin.engine.doi_pdi_reference import (
    MU_M,
    R_M,
    reference_doi_pdi,
)

EPOCH = datetime(2027, 1, 10, tzinfo=UTC)


def identity(state: np.ndarray, epoch: datetime) -> np.ndarray:
    del epoch
    return state.copy()


def initial_state() -> np.ndarray:
    """Near-polar orbit with PDI directly over the specified south-pole target."""
    lat, lon = np.radians(-89.0), np.radians(30.0)
    target = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    start = -target
    tangent = np.cross(np.array([0.0, 0.0, 1.0]), start)
    tangent /= np.linalg.norm(tangent)
    radius = R_M + 100_000
    return np.r_[radius * start, np.sqrt(MU_M / radius) * tangent]


def test_site_aligned_two_body_reference_is_continuous() -> None:
    result = reference_doi_pdi(initial_state(), EPOCH, -89.0, 30.0, identity)
    assert result.status == "REFERENCE_ALIGNED"
    assert result.approach_error_m < 5_000
    assert result.plane_offset_m < 1
    assert result.aligned_pdi_moon_me_m_mps is not None
    before = np.asarray(result.doi_pre.j2000_m_mps)
    after = np.asarray(result.doi_post.j2000_m_mps)
    assert np.linalg.norm(before[:3] - after[:3]) == pytest.approx(0, abs=0.01)
    assert np.linalg.norm(before[3:] - after[3:]) == pytest.approx(result.doi_delta_v_mps, abs=1e-7)
    assert np.linalg.norm(result.pdi.j2000_m_mps[:3]) == pytest.approx(R_M + 15_000, abs=0.001)
    assert np.linalg.norm(result.loi.j2000_m_mps[:3]) == pytest.approx(R_M + 100_000, abs=0.001)
    assert result.samples[0].epoch_utc >= EPOCH
    assert result.samples[-1].epoch_utc == result.pdi.epoch_utc
    assert all(
        left.epoch_utc <= right.epoch_utc
        for left, right in zip(result.samples, result.samples[1:], strict=False)
    )


def test_site_outside_orbital_plane_does_not_fake_aligned_pdi() -> None:
    result = reference_doi_pdi(initial_state(), EPOCH, -85.0, 120.0, identity, tolerance_m=50)
    assert result.status == "NO_ALIGNED_REFERENCE"
    assert result.aligned_pdi_moon_me_m_mps is None
    assert result.approach_error_m > result.tolerance_m


def test_rejects_unsupported_or_nonphysical_handoff() -> None:
    with pytest.raises(ValueError):
        reference_doi_pdi(np.zeros(6), EPOCH, -89.0, 30.0, identity)
    invalid = initial_state()
    invalid[3:] *= 0.5
    with pytest.raises(ValueError, match="near-circular"):
        reference_doi_pdi(invalid, EPOCH, -89.0, 30.0, identity)
    with pytest.raises(ValueError):
        reference_doi_pdi(initial_state(), EPOCH, -79.0, 30.0, identity)
