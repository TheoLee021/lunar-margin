"""Landing grid API contract and validation without external NASA downloads."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from lunar_margin.app.landing_grid import (
    LandingGridQuery,
    LandingGridResponse,
    get_grid_evaluator,
)
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(Settings())

    def fake(query: LandingGridQuery) -> LandingGridResponse:
        if query.lat == -80:
            raise ValueError("outside the DEM")
        return LandingGridResponse.model_validate(
            {
                "lat": query.lat, "lon": query.lon,
                "assessment_radius_m": query.assessment_radius_m,
                "target_radius_m": query.target_radius_m,
                "sample_step_m": 80.0, "slope_baseline_m": 160.0,
                "roughness_window_m": 400.0, "max_slope_deg": query.max_slope_deg,
                "max_roughness_m": query.max_roughness_m,
                "total_target_centers": 1, "passing_target_centers": 0,
                "cells": [
                    {"dx_m": 0, "dy_m": 0, "slope_deg": None,
                     "roughness_rms_m": None, "valid": False,
                     "in_assessment_circle": True}
                ],
                "targets": [
                    {"dx_m": 0, "dy_m": 0, "lat_deg": query.lat, "lon_deg": query.lon,
                     "cells_intersecting": 1, "valid_cells": 0,
                     "coverage_fraction": 0, "slope_p95_deg": None,
                     "slope_max_deg": None, "roughness_max_m": None,
                     "terrain_screen_pass": False, "reasons": ["terrain_incomplete"]}
                ],
                "best_target": None,
                "landing_safety_status": "UNVERIFIED",
                "limitation": "DEM-scale screening, not landing safety certification",
            }
        )

    app.dependency_overrides[get_grid_evaluator] = lambda: fake
    with TestClient(app) as test_client:
        yield test_client


def test_landing_grid_exposes_missing_data_without_false_pass(client: TestClient) -> None:
    response = client.get("/analysis/landing-grid", params={"lat": -89.5, "lon": 222})
    assert response.status_code == 200
    body = response.json()
    assert body["best_target"] is None
    assert body["passing_target_centers"] == 0
    assert body["targets"][0]["reasons"] == ["terrain_incomplete"]
    assert body["landing_safety_status"] == "UNVERIFIED"
    assert body["assessment_radius_m"] == 250
    assert body["target_radius_m"] == 50


@pytest.mark.parametrize(
    "parameters",
    [
        {"lat": -79}, {"lon": 400}, {"assessment_radius_m": 100},
        {"target_radius_m": 0}, {"target_radius_m": 100, "assessment_radius_m": 100},
        {"max_slope_deg": 100}, {"max_roughness_m": -1}, {"extra": "unexpected"},
    ],
)
def test_invalid_landing_grid_queries_are_rejected(
    client: TestClient, parameters: dict[str, int | float | str]
) -> None:
    response = client.get(
        "/analysis/landing-grid", params={"lat": -89.5, "lon": 222, **parameters}
    )
    assert response.status_code == 422


def test_outside_dem_is_reported_as_422(client: TestClient) -> None:
    response = client.get("/analysis/landing-grid", params={"lat": -80, "lon": 0})
    assert response.status_code == 422
