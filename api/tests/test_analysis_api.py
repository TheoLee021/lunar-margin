from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from lunar_margin.app.analysis import AnalysisQuery, Kind, get_analyzer, get_settings
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.engine.horizon import HorizonProfile
from lunar_margin.engine.metrics import SiteAnalysis, VisibilityMetrics

START = datetime(2027, 1, 1, tzinfo=UTC)
PARAMS: dict[str, str | float] = {
    "lat": -89.7,
    "lon": 130.0,
    "start": "2027-01-01T00:00:00Z",
    "end": "2027-01-01T03:00:00Z",
    "step_minutes": 60,
}


def fake_analysis(visible: list[bool], step_minutes: int = 60) -> SiteAnalysis:
    n = len(visible)
    return SiteAnalysis(
        metrics=VisibilityMetrics(0.5, 2.0, 1.0, None),
        horizon=HorizonProfile(np.array([0.0, 1.0]), np.array([1.5, 1.25])),
        times=[START + timedelta(minutes=step_minutes * i) for i in range(n)],
        body_azimuth_deg=np.full(n, 212.0),
        body_elevation_deg=np.linspace(-1.0, 1.0, n),
        visible=np.array(visible, dtype=np.bool_),
        step_minutes=step_minutes,
    )


@pytest.fixture
def calls() -> list[tuple[Kind, AnalysisQuery]]:
    return []


@pytest.fixture
def client(calls: list[tuple[Kind, AnalysisQuery]]) -> Iterator[TestClient]:
    def analyzer(kind: Kind, query: AnalysisQuery) -> SiteAnalysis:
        calls.append((kind, query))
        if query.lat == -80.0:
            raise ValueError("(-80.0, 0.0) is outside the DEM")
        return fake_analysis([True, False, False])

    app = create_app(Settings())
    app.dependency_overrides[get_analyzer] = lambda: analyzer
    yield TestClient(app)


def test_illumination_returns_contract_schema(client: TestClient) -> None:
    response = client.get("/analysis/illumination", params=PARAMS)

    assert response.status_code == 200
    body = response.json()
    assert body["lat"] == -89.7
    assert body["step_minutes"] == 60
    assert body["observer_height_m"] == 0
    assert body["metrics"] == {
        "visible_fraction": 0.5,
        "longest_dark_hours": 2.0,
        "windows_per_24h": 1.0,
        "mean_elevation_deg": None,
    }
    assert body["horizon"] == {"azimuth_deg": [0.0, 1.0], "elevation_deg": [1.5, 1.25]}
    assert body["series"]["times"] == [
        "2027-01-01T00:00:00Z",
        "2027-01-01T01:00:00Z",
        "2027-01-01T02:00:00Z",
    ]
    assert body["series"]["visible"] == [True, False, False]
    assert len(body["series"]["body_azimuth_deg"]) == 3
    assert body["windows"] == [{"start": "2027-01-01T00:00:00Z", "end": "2027-01-01T01:00:00Z"}]
    assert body["dark_periods"] == [
        {"start": "2027-01-01T01:00:00Z", "end": "2027-01-01T03:00:00Z"}
    ]


def test_each_endpoint_selects_its_body(
    client: TestClient, calls: list[tuple[Kind, AnalysisQuery]]
) -> None:
    client.get("/analysis/illumination", params=PARAMS)
    client.get("/analysis/earth-visibility", params=PARAMS)

    kinds = [kind for kind, _ in calls]
    assert kinds == ["SUN", "EARTH"]


@pytest.mark.parametrize(
    "override",
    [
        {"lat": -79.9},
        {"lat": -90.1},
        {"end": "2027-01-01T00:00:00Z"},  # end == start
        {"end": "2026-12-31T00:00:00Z"},  # end < start
        {"end": "2031-01-01T00:00:00Z"},  # 3년 초과
        {"start": "2027-01-01T00:00:00"},  # 타임존 없음
        {"step_minutes": 4},
        {"step_minutes": 361},
        {"observer_height_m": -1},
        {"observer_height_m": 101},
        {"unknown": 1},
    ],
)
def test_invalid_query_is_422(client: TestClient, override: dict[str, str | float]) -> None:
    response = client.get("/analysis/illumination", params={**PARAMS, **override})

    assert response.status_code == 422


def test_too_many_samples_is_422(client: TestClient) -> None:
    # 3년 / 5분 = 315,360개 > 상한
    params = {**PARAMS, "end": "2029-12-31T00:00:00Z", "step_minutes": 5}

    assert client.get("/analysis/illumination", params=params).status_code == 422


def test_point_outside_dem_is_422(client: TestClient) -> None:
    response = client.get("/analysis/illumination", params={**PARAMS, "lat": -80.0})

    assert response.status_code == 422
    assert "outside" in response.json()["detail"]


def app_with_data_dir(data_dir: Path) -> TestClient:
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=data_dir)
    return TestClient(app)


def test_missing_data_is_503_not_500(tmp_path: Path) -> None:
    response = app_with_data_dir(tmp_path).get("/analysis/illumination", params=PARAMS)

    assert response.status_code == 503
    assert "fetch" in response.json()["detail"]


@pytest.mark.usefixtures("spice_kernels")
def test_real_data_end_to_end(data_dir: Path) -> None:
    params = {**PARAMS, "lat": -85.99, "lon": 0.12, "end": "2027-02-01T00:00:00Z"}

    response = app_with_data_dir(data_dir).get("/analysis/earth-visibility", params=params)

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["visible_fraction"] > 0.9  # Malapert는 지구가 거의 항상 보인다
    assert len(body["series"]["times"]) == 31 * 24  # step_minutes=60
    assert len(body["horizon"]["azimuth_deg"]) == 360


def test_clearance_series_and_p10_use_geometric_angles_without_rf() -> None:
    def measured(kind: Kind, query: AnalysisQuery) -> SiteAnalysis:
        return SiteAnalysis(
            metrics=VisibilityMetrics(0.4, 1.0, 1.0, 1.0),
            horizon=HorizonProfile(
                np.array([0.0, 90.0, 180.0, 270.0]), np.array([0.0, 2.0, 4.0, 2.0])
            ),
            times=[query.start + timedelta(hours=i) for i in range(5)],
            body_azimuth_deg=np.array([0.0, 90.0, 180.0, 315.0, -45.0]),
            body_elevation_deg=np.array([-1.0, 4.0, 4.0, 2.0, 0.0]),
            visible=np.array([False, True, False, True, False]),
            step_minutes=60,
        )

    app = create_app(Settings())
    app.dependency_overrides[get_analyzer] = lambda: measured
    client = TestClient(app)
    for target in ("illumination", "earth-visibility"):
        response = client.get(
            f"/analysis/{target}", params={**PARAMS, "end": "2027-01-01T05:00:00Z"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["series"]["terrain_clearance_deg"] == [-1.0, 2.0, 0.0, 1.0, -1.0]
        assert body["visible_clearance_p10_deg"] == pytest.approx(1.1)
        assert body["series"]["visible"] == [False, True, False, True, False]
