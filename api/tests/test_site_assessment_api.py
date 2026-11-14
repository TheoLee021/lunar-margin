"""FastAPI contract checks; independent of DEM downloads or SPICE kernels."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.app.site_assessment import (
    BodySummary,
    SiteAssessment,
    SiteQuery,
    TerrainSummary,
    get_site_assessor,
)

START = datetime(2027, 1, 10, tzinfo=UTC)
PARAMS = {
    "lat": -89.5,
    "lon": 222.0,
    "start": START.isoformat(),
    "end": (START + timedelta(days=7)).isoformat(),
    "step_minutes": 30,
}


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(Settings())

    def fake(query: SiteQuery) -> SiteAssessment:
        if query.lat == -80:
            raise ValueError("outside DEM")
        return SiteAssessment(
            lat=query.lat,
            lon=query.lon,
            start=query.start,
            end=query.end,
            step_minutes=query.step_minutes,
            sun=BodySummary(
                visible_fraction=0.8,
                longest_dark_hours=36.0,
                windows_per_24h=1.0,
            ),
            earth=BodySummary(
                visible_fraction=0.7,
                longest_dark_hours=48.0,
                windows_per_24h=0.5,
            ),
            terrain=TerrainSummary(
                elevation_m=400.0,
                slope_deg=3.5,
                roughness_rms_m=1.0,
                slope_baseline_m=query.slope_baseline_m,
                roughness_window_m=query.roughness_window_m,
                dem_pixel_m=80.0,
                limitation="DEM scale only",
            ),
        )

    app.dependency_overrides[get_site_assessor] = lambda: fake
    with TestClient(app) as c:
        yield c


def test_site_assessment_contract(client: TestClient) -> None:
    res = client.get("/analysis/site-assessment", params=PARAMS)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["sun"]["visible_fraction"] == 0.8
    assert body["earth"]["longest_dark_hours"] == 48
    assert body["terrain"]["slope_deg"] == 3.5
    assert body["terrain"]["dem_pixel_m"] == 80
    assert body["terrain"]["slope_baseline_m"] == 160
    assert body["terrain"]["roughness_window_m"] == 400


@pytest.mark.parametrize(
    "patch",
    [
        {"lat": -79.0},
        {"end": START.isoformat()},
        {"end": (START + timedelta(days=29)).isoformat()},
        {"step_minutes": 4},
        {"slope_baseline_m": 20},
        {"roughness_window_m": 40},
        {"unrecognized": "bad"},
    ],
)
def test_invalid_query_fails_422(client: TestClient, patch: dict[str, str | float | int]) -> None:
    response = client.get("/analysis/site-assessment", params={**PARAMS, **patch})
    assert response.status_code == 422


def test_outside_dem_returns_422(client: TestClient) -> None:
    res = client.get("/analysis/site-assessment", params={**PARAMS, "lat": -80})
    assert res.status_code == 422
    assert "outside" in res.json()["detail"]
