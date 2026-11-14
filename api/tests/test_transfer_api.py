from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings

PARAMS = {"departure": "2027-01-06T00:00:00Z", "arrival": "2027-01-10T00:00:00Z"}


def test_transfer_api_returns_dated_computed_samples(data_dir: Path) -> None:
    app = create_app(Settings(data_dir=data_dir))
    response = TestClient(app).get("/trajectory/transfer", params=PARAMS)
    assert response.status_code == 200
    body = response.json()
    assert body["departure"] == PARAMS["departure"]
    assert body["arrival"] == PARAMS["arrival"]
    assert body["metrics"]["arrival_position_error_km"] < 0.05
    assert body["transfer"][-1]["seconds"] == 345600
    assert len(body["capture"]) > 100
    assert len(body["moon_orbit_km"]) > 100


def test_transfer_rejects_naive_and_unsupported_dates_without_data(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    for override in [
        {"departure": "2027-01-06T00:00:00"},
        {"arrival": "2027-01-06T00:00:00Z"},
        {"arrival": "2027-02-06T00:00:00Z"},
        {"departure": "1800-01-06T00:00:00Z", "arrival": "1800-01-10T00:00:00Z"},
        {"extra": "not allowed"},
    ]:
        response = client.get("/trajectory/transfer", params={**PARAMS, **override})
        assert response.status_code == 422


def test_transfer_missing_spice_is_503(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    response = client.get("/trajectory/transfer", params=PARAMS)
    assert response.status_code == 503
    assert "SPICE" in response.json()["detail"]


def test_transfer_normalizes_offset_dates_to_utc(data_dir: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=data_dir)))
    response = client.get(
        "/trajectory/transfer",
        params={
            "departure": "2027-01-06T09:00:00+09:00",
            "arrival": "2027-01-10T09:00:00+09:00",
        },
    )
    assert response.status_code == 200
    assert response.json()["departure"] == PARAMS["departure"]
    assert response.json()["arrival"] == PARAMS["arrival"]


def test_transfer_api_preserves_dates_and_tangency_at_perilune(data_dir: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=data_dir)))
    for departure, arrival in [("2027-01-06", "2027-01-10"), ("2027-01-13", "2027-01-18")]:
        params = {"departure": departure + "T00:00:00Z", "arrival": arrival + "T00:00:00Z"}
        response = client.get("/trajectory/transfer", params=params)
        assert response.status_code == 200
        body = response.json()
        assert body["departure"] == params["departure"]
        assert body["arrival"] == params["arrival"]
        tail = body["transfer"][-3:]
        times = np.array([s["seconds"] - tail[-1]["seconds"] for s in tail])
        positions = np.array(
            [np.array(s["spacecraft_km"]) - s["moon_km"] for s in tail], dtype=np.float64
        )
        velocity = np.array([np.polyfit(times, positions[:, axis], 2)[1] for axis in range(3)])
        radial = np.asarray(positions[-1], dtype=np.float64).copy()
        radial /= np.linalg.norm(radial)
        assert abs(float(np.dot(velocity, radial))) < 0.005
        assert abs(body["metrics"]["arrival_altitude_km"] - 100) < 0.05
        assert body["transfer"][-1] == body["capture"][0]
