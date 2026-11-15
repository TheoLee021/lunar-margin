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


def test_solar_continuity_caps_a_partial_sample_to_the_requested_window() -> None:
    from datetime import timedelta

    def daylight(kind: Kind, query: AnalysisQuery) -> SiteAnalysis:
        count = math.ceil((query.end - query.start).total_seconds() / (query.step_minutes * 60))
        return SiteAnalysis(
            metrics=VisibilityMetrics(1.0, 0.0, 1.0, 1.0),
            horizon=HorizonProfile(np.array([0.0, 180.0]), np.array([0.0, 0.0])),
            times=[query.start + timedelta(minutes=i * query.step_minutes) for i in range(count)],
            body_azimuth_deg=np.zeros(count),
            body_elevation_deg=np.ones(count),
            visible=np.ones(count, dtype=np.bool_),
            step_minutes=query.step_minutes,
        )

    app = create_app(Settings())
    app.dependency_overrides[get_analyzer] = lambda: daylight
    app.dependency_overrides[get_dem] = lambda: make_dem(np.zeros((N, N)))
    response = TestClient(app).get(
        "/analysis/site-assessment",
        params={
            **PARAMS,
            "end": "2027-01-01T00:10:00Z",
            "step_minutes": 30,
        },
    )
    assert response.status_code == 200
    assert response.json()["solar_continuity"] == {
        "longest_sun_visible_hours": pytest.approx(1 / 6),
        "visibility_transitions": 0,
    }


@pytest.mark.parametrize(
    ("pattern", "duration", "longest", "transitions"),
    [
        ("DVVV", 100, 70 / 60, 1),
        ("VVDV", 100, 1.0, 2),
        ("DDDD", 100, 0.0, 0),
        ("VVVV", 100, 100 / 60, 0),
        ("VDVD", 120, 0.5, 3),
    ],
)
def test_solar_continuity_counts_partial_runs_and_transitions(
    pattern: str, duration: int, longest: float, transitions: int
) -> None:
    from datetime import timedelta

    def measured(kind: Kind, query: AnalysisQuery) -> SiteAnalysis:
        mask = np.array([c == "V" for c in pattern], dtype=np.bool_)
        return SiteAnalysis(
            metrics=METRICS[kind],
            horizon=HorizonProfile(np.array([0.0, 180.0]), np.zeros(2)),
            times=[query.start + timedelta(minutes=i * 30) for i in range(len(mask))],
            body_azimuth_deg=np.zeros(len(mask)),
            body_elevation_deg=np.where(mask, 1.0, -1.0),
            visible=mask,
            step_minutes=30,
        )

    app = create_app(Settings())
    app.dependency_overrides[get_analyzer] = lambda: measured
    app.dependency_overrides[get_dem] = lambda: make_dem(np.zeros((N, N)))
    end = datetime(2027, 1, 1, tzinfo=UTC) + timedelta(minutes=duration)
    response = TestClient(app).get(
        "/analysis/site-assessment",
        params={
            **PARAMS,
            "end": end.isoformat(),
            "step_minutes": 30,
        },
    )
    assert response.status_code == 200
    assert response.json()["solar_continuity"] == {
        "longest_sun_visible_hours": pytest.approx(longest),
        "visibility_transitions": transitions,
    }


def test_candidate_summary_includes_separate_sun_and_earth_clearance(
    client_for: Callable[[PolarDem], TestClient],
) -> None:
    client = client_for(make_dem(np.zeros((N, N))))
    response = client.get("/analysis/site-assessment", params=PARAMS)
    assert response.status_code == 200
    # This fixture's elevations are below its terrain horizon.
    assert response.json()["terrain_clearance"] == {
        "sun_visible_p10_deg": None,
        "earth_visible_p10_deg": None,
    }
