"""HTTP contract tests for preliminary descent-reference endpoint."""

from collections.abc import Generator

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray

from lunar_margin.app.analysis import get_dem
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings

Vec = NDArray[np.float64]


class FlatDem:
    def sample_height_lonlat_m(self, lat_deg: Vec, lon_deg: Vec) -> Vec:
        return np.zeros_like(lat_deg)


@pytest.fixture
def client() -> Generator[TestClient]:
    app = create_app(Settings(horizon_table_download_on_start=False))
    app.dependency_overrides[get_dem] = lambda: FlatDem()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def payload() -> dict[str, object]:
    return {
        "epoch_utc": "2027-01-10T00:00:00Z",
        "primary_site": {"lat_deg": -89.0, "lon_deg": 30.0},
        "backup_sites": [{"lat_deg": -89.001, "lon_deg": 30.02}],
        "include_earth_los": False,
    }


def test_reference_endpoint_returns_same_initial_state_and_two_targets(
    client: TestClient,
) -> None:
    response = client.post("/trajectory/descent-reference", json=payload())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["model"] == "REFERENCE_ONLY_NOT_FLIGHT_CERTIFIED"
    assert data["pdi"]["altitude_reference_m"] == pytest.approx(15000)
    assert len(data["results"]) == 2
    assert all(item["path"]["status"] == "REFERENCE_FEASIBLE" for item in data["results"])
    assert data["results"][0]["path"]["samples"][0]["moon_me_xyz_m"] == data["results"][1][
        "path"
    ]["samples"][0]["moon_me_xyz_m"]
    assert data["results"][0]["earth_los_samples"] is None


def test_reference_endpoint_rejects_invalid_vehicle_and_backup_count(
    client: TestClient,
) -> None:
    bad = payload()
    bad["vehicle"] = {"wet_mass_kg": 450, "dry_mass_kg": 1200}
    assert client.post("/trajectory/descent-reference", json=bad).status_code == 422
    bad2 = payload()
    bad2["backup_sites"] = [{"lat_deg": -89.0, "lon_deg": 30.0}] * 4
    assert client.post("/trajectory/descent-reference", json=bad2).status_code == 422


def test_reference_endpoint_does_not_invent_data_when_target_outside_roi(
    client: TestClient,
) -> None:
    bad = payload()
    bad["primary_site"] = {"lat_deg": -70.0, "lon_deg": 0.0}
    assert client.post("/trajectory/descent-reference", json=bad).status_code == 422
