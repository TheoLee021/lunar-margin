import math
from collections.abc import Callable
from datetime import UTC, datetime

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray

from lunar_margin.app.analysis import AnalysisQuery, Kind, get_analyzer, get_dem
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.horizon import HorizonProfile
from lunar_margin.engine.metrics import SiteAnalysis, VisibilityMetrics
from lunar_margin.pipeline.pds_label import PolarGridLabel

# 극 중심 101x101, 100 m 격자 (±5 km). (-89.9°, 0°)는 극에서 y≈3 km
N = 101
C = 50
SCALE_M = 100.0
PARAMS: dict[str, str | float] = {
    "lat": -89.9,
    "lon": 0.0,
    "start": "2027-01-01T00:00:00Z",
    "end": "2027-01-01T03:00:00Z",
    "step_minutes": 60,
}
METRICS: dict[Kind, VisibilityMetrics] = {
    "SUN": VisibilityMetrics(0.25, 10.0, 0.5, 1.0),
    "EARTH": VisibilityMetrics(0.75, 2.0, 1.5, None),
}


def make_dem(heights_m: NDArray[np.float64]) -> PolarDem:
    label = PolarGridLabel(
        lines=N,
        samples=N,
        map_scale_m=SCALE_M,
        line_offset=float(C),
        sample_offset=float(C),
        radius_km=1737.4,
        height_offset_km=1737.4,
        center_lat_deg=-90.0,
    )
    return PolarDem((heights_m / 1000.0).astype(np.float32), label)


def inclined_dem(degrees: float) -> NDArray[np.float64]:
    x = (np.arange(N, dtype=np.float64) - C) * SCALE_M
    return np.tile(math.tan(math.radians(degrees)) * x, (N, 1))


def analyzer(kind: Kind, query: AnalysisQuery) -> SiteAnalysis:
    return SiteAnalysis(
        metrics=METRICS[kind],
        horizon=HorizonProfile(np.array([0.0, 1.0]), np.array([1.5, 1.25])),
        times=[datetime(2027, 1, 1, tzinfo=UTC)],
        body_azimuth_deg=np.array([212.0]),
        body_elevation_deg=np.array([0.5]),
        visible=np.array([True]),
        step_minutes=query.step_minutes,
    )


@pytest.fixture
def client_for() -> Callable[[PolarDem], TestClient]:
    def build(dem: PolarDem) -> TestClient:
        app = create_app(Settings())
        app.dependency_overrides[get_analyzer] = lambda: analyzer
        app.dependency_overrides[get_dem] = lambda: dem
        return TestClient(app)

    return build


def test_site_assessment_combines_sun_earth_and_regional_terrain(
    client_for: Callable[[PolarDem], TestClient],
) -> None:
    client = client_for(make_dem(inclined_dem(10.0)))

    response = client.get("/analysis/site-assessment", params=PARAMS)

    assert response.status_code == 200
    body = response.json()
    assert (body["lat"], body["lon"]) == (-89.9, 0.0)
    assert (body["start"], body["end"]) == ("2027-01-01T00:00:00Z", "2027-01-01T03:00:00Z")
    assert body["sun"] == {
        "visible_fraction": 0.25,
        "longest_dark_hours": 10.0,
        "windows_per_24h": 0.5,
        "mean_elevation_deg": 1.0,
    }
    assert body["earth"]["visible_fraction"] == 0.75
    assert body["earth"]["mean_elevation_deg"] is None
    terrain = body["terrain"]
    assert terrain["slope_p95_deg"] == pytest.approx(10.0, abs=0.05)
    assert terrain["coverage_fraction"] == 1.0
    assert terrain["assessment_radius_m"] == 250.0
    assert terrain["dem_pixel_m"] == SCALE_M
    assert terrain["landing_safety_status"] == "UNVERIFIED"
    assert "series" not in body


def test_site_outside_the_dem_is_rejected_with_422(
    client_for: Callable[[PolarDem], TestClient],
) -> None:
    client = client_for(make_dem(np.zeros((N, N))))

    response = client.get("/analysis/site-assessment", params={**PARAMS, "lat": -89.0})

    assert response.status_code == 422
    assert "outside" in response.json()["detail"]


def test_dem_gap_near_the_site_is_reported_as_partial_coverage(
    client_for: Callable[[PolarDem], TestClient],
) -> None:
    heights = np.zeros((N, N))
    heights[20, C + 3] = np.nan  # 지점(행 ≈19.7, 열 50)에서 약 300 m 떨어진 결측 픽셀
    client = client_for(make_dem(heights))

    response = client.get("/analysis/site-assessment", params=PARAMS)

    assert response.status_code == 200
    terrain = response.json()["terrain"]
    assert 0.0 < terrain["coverage_fraction"] < 1.0
    assert terrain["slope_p95_deg"] is not None
