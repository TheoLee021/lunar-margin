"""HTTP contract for the dated transfer -> LOI -> DOI/PDI reference pipeline.

The response test stubs the expensive dated transfer and lunar frame service.
Physical validation is in the engine tests, not this API routing test.
"""
from datetime import UTC, datetime
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from lunar_margin.app import doi_pdi_reference as endpoint
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.engine.doi_pdi_reference import MU_M, R_M

EPOCH = datetime(2027, 1, 10, tzinfo=UTC)


def _loi_state() -> list[float]:
    lat, lon = np.radians(-89.0), np.radians(30.0)
    site = np.array(
        [np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)]
    )
    start = -site
    tangent = np.cross(np.array([0.0, 0.0, 1.0]), start)
    tangent /= np.linalg.norm(tangent)
    radius = R_M + 100_000
    return (np.r_[radius * start, np.sqrt(MU_M / radius) * tangent] / 1000).tolist()


def test_reference_endpoint_uses_loi_handoff(monkeypatch: pytest.MonkeyPatch) -> None:
    called = []

    def transfer(start: datetime, end: datetime, data_dir: object) -> object:
        del data_dir
        called.append((start, end))
        return SimpleNamespace(
            loi_handoff=SimpleNamespace(
                epoch_utc=EPOCH, post_loi_j2000_km_kmps=_loi_state()
            )
        )

    monkeypatch.setattr(endpoint, "calculate_transfer", transfer)
    monkeypatch.setattr(
        endpoint,
        "inertial_moon_state_to_moon_me",
        lambda state, epoch: state.copy(),
    )
    app = create_app(Settings(horizon_table_download_on_start=False))
    with TestClient(app) as client:
        response = client.post(
            "/trajectory/doi-pdi-reference",
            json={
                "departure": "2027-01-06T00:00:00Z",
                "arrival": "2027-01-10T00:00:00Z",
                "target_lat_deg": -89.0,
                "target_lon_deg": 30.0,
            },
        )
    assert response.status_code == 200, response.text
    data = response.json()
    assert called
    assert data["status"] == "REFERENCE_ALIGNED"
    assert data["model"] == "TWO_BODY_REFERENCE_NO_MISSION_FEASIBILITY"
    assert data["pdi"]["epoch_utc"]
    assert data["samples"]
    assert data["doi_delta_v_mps"] > 0


def test_reference_endpoint_rejects_invalid_date_window() -> None:
    app = create_app(Settings(horizon_table_download_on_start=False))
    with TestClient(app) as client:
        response = client.post(
            "/trajectory/doi-pdi-reference",
            json={
                "departure": "2027-01-10T00:00:00Z",
                "arrival": "2027-01-10T00:00:00Z",
                "target_lat_deg": -89.0,
                "target_lon_deg": 30.0,
            },
        )
    assert response.status_code == 422
