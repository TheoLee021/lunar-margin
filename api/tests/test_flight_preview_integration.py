"""Verify integrated route never synthesizes a PDI or hides a failed profile."""
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Callable

import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.app import flight_preview as module
from lunar_margin.app.flight_preview import FlightPreviewQuery
from lunar_margin.app.settings import Settings
from lunar_margin.engine.descent_reference import PathResult, PdiState, R_M, surface_vector
from lunar_margin.engine.doi_pdi_reference import (
    DoiPdiReference,
    PhaseState,
    TrajectorySample,
)

EPOCH = datetime(2027, 1, 10, tzinfo=UTC)
Vec = NDArray[np.float64]


def query() -> FlightPreviewQuery:
    return FlightPreviewQuery(
        departure=datetime(2027, 1, 6, tzinfo=UTC),
        arrival=EPOCH,
        latitude=-89.0,
        longitude=30.0,
    )


def orbit(aligned: bool) -> DoiPdiReference:
    target = surface_vector(-89.0, 30.0)
    pdi_state = np.r_[(R_M + 15_000) * target, [1500.0, 0, 0]]
    state = PhaseState(EPOCH, "PDI", pdi_state.tolist(), pdi_state.tolist())
    sample = TrajectorySample(
        EPOCH, "DOI_COAST", pdi_state[:3].tolist(), pdi_state[:3].tolist(), 15000
    )
    return DoiPdiReference(
        model="TWO_BODY_REFERENCE_NO_MISSION_FEASIBILITY",
        status="REFERENCE_ALIGNED" if aligned else "NO_ALIGNED_REFERENCE",
        target_lat_deg=-89,
        target_lon_deg=30,
        approach_error_m=0 if aligned else 10000,
        plane_offset_m=0,
        tolerance_m=5000,
        parking_altitude_m=100000,
        pdi_altitude_m=15000,
        parking_period_s=7000,
        coast_time_s=3300,
        doi_delta_v_mps=19,
        loi=state,
        doi_pre=state,
        doi_post=state,
        pdi=state,
        aligned_pdi_moon_me_m_mps=pdi_state.tolist() if aligned else None,
        samples=[sample, sample],
    )


def prepare(monkeypatch: pytest.MonkeyPatch, aligned: bool) -> None:
    def transfer(start: datetime, end: datetime, directory: Path) -> SimpleNamespace:
        del start, end, directory
        return SimpleNamespace(
            loi_handoff=SimpleNamespace(
                epoch_utc=EPOCH, post_loi_j2000_km_kmps=[0.0] * 6
            )
        )

    def bridge(
        state: Vec,
        epoch: datetime,
        lat: float,
        lon: float,
        transform: Callable[[Vec, datetime], Vec],
        *,
        tolerance_m: float,
    ) -> DoiPdiReference:
        del state, epoch, lat, lon, transform, tolerance_m
        return orbit(aligned)

    monkeypatch.setattr(module, "calculate_transfer", transfer)
    monkeypatch.setattr(module, "reference_doi_pdi", bridge)


def test_rejects_non_aligned_reference_without_descent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepare(monkeypatch, aligned=False)

    def forbidden(*args: object, **kwargs: object) -> PathResult:
        del args, kwargs
        raise AssertionError("Never fabricate a descent after a failed PDI gate")

    monkeypatch.setattr(module, "evaluate_reference", forbidden)
    result = module.flight_preview(query(), Settings(), object())  # type: ignore[arg-type]
    assert result.status == "NO_PDI_REFERENCE"
    assert result.descent is None
    assert result.descent_epoch_utc is None


def test_uses_exact_moon_fixed_pdi_state_for_descent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepare(monkeypatch, aligned=True)
    captured: list[PdiState] = []

    def inspect(*args: object, **kwargs: object) -> PathResult:
        del kwargs
        pdi = args[1]
        assert isinstance(pdi, PdiState)
        captured.append(pdi)
        return PathResult("ENGINE_LIMIT", 720.0, 0.0, 30.0, 0.0, 20000.0, 0.0, [])

    monkeypatch.setattr(module, "evaluate_reference", inspect)
    result = module.flight_preview(query(), Settings(), object())  # type: ignore[arg-type]
    assert result.status == "DESCENT_REFERENCE_FAILED"
    assert result.descent is not None
    assert captured
    expected = np.asarray(result.orbit.aligned_pdi_moon_me_m_mps)
    actual = np.r_[captured[0].position_m, captured[0].velocity_mps]
    assert np.array_equal(actual, expected)
