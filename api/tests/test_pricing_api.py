from datetime import date
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.main import create_app
from lunar_margin.app.pricing import get_pricing_dem
from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.mission import MissionRequest, plan_search
from lunar_margin.engine.dem import PolarDem
from lunar_margin.pipeline.pds_label import PolarGridLabel


def test_calendar_averages_every_eligible_fine_cell_including_unselected(tmp_path: Path) -> None:
    mission = MissionRequest(landing_date=date(2027, 1, 10), mission_duration_days=14)
    run = tmp_path / "candidates" / mission.run_id()
    run.mkdir(parents=True)
    (run / "mission.json").write_text(mission.model_dump_json())
    (run / "candidates.json").write_text(
        '{"config":' + plan_search(mission).config.model_dump_json() + "}"
    )
    np.savez(
        run / "sites.npz",
        x_m=[0.0, 500.0, 0.0, 0.0, 0.0],
        y_m=[0.0] * 5,
        ix=[0, 1, 0, 0, 0],
        iy=[0] * 5,
        spacing_m=[500.0, 500.0, 2000.0, 500.0, 500.0],
        stage=[1, 1, 0, 1, 1],
        status=[0, 0, 0, 1, 2],
        skipped_mask=[0] * 5,
        rank=[1, 0, 0, 0, 0],
    )
    dem = PolarDem(
        np.zeros((61, 61), dtype=np.float32), PolarGridLabel(61, 61, 80, 30, 30, 1737.4, 0, -90)
    )
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    app.dependency_overrides[get_pricing_dem] = lambda: dem
    client = TestClient(app)
    response = client.post(
        "/pricing/calendar",
        json={
            "mission": mission.model_dump(mode="json"),
            "landing_dates": ["2027-01-10", "2027-01-11"],
            "mass_kg": 24,
            "delivery": "surface",
        },
    )
    assert response.status_code == 200
    first, missing = response.json()["dates"]
    assert first["state"] == "ready"
    assert first["pricing"]["counts"]["priced"] == 2
    assert first["pricing"]["counts"]["coarse_ignored"] == 1
    assert first["pricing"]["mean"]["adjusted_usd"] == 29_300_000
    assert missing["state"] == "not_computed" and missing["pricing"] is None
    cells = client.get(
        f"/pricing/runs/{mission.run_id()}?mass_kg=24&delivery=surface&include_cells=true"
    )
    assert len(cells.json()["cells"]) == 2
    assert cells.json()["cells"][1]["id"] == "SP500_+1_+0"
    assert cells.json()["mean"]["demand_unknown"]
    # The spec requires an explicit 1.10 fallback when terrain cannot be derived.
    app.dependency_overrides[get_pricing_dem] = lambda: None
    unknown = client.get(f"/pricing/runs/{mission.run_id()}?mass_kg=24&delivery=surface")
    assert unknown.status_code == 200
    assert unknown.json()["mean"]["adjusted_usd"] == pytest.approx(32_180_000)
    assert unknown.json()["counts"]["terrain_unknown"] == 2


def test_dates_outside_ephemeris_are_422_not_a_server_error(tmp_path: Path) -> None:
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    app.dependency_overrides[get_pricing_dem] = lambda: PolarDem(
        np.zeros((61, 61), dtype=np.float32), PolarGridLabel(61, 61, 80, 30, 30, 1737.4, 0, -90)
    )
    response = TestClient(app).post(
        "/pricing/calendar",
        json={
            "mission": {"landing_date": "2027-01-10", "mission_duration_days": 14},
            "landing_dates": ["2200-01-01"],
            "mass_kg": 24,
            "delivery": "surface",
        },
    )
    assert response.status_code == 422


def test_search_without_slope_filter_does_not_add_a_hidden_price_slope_gate(tmp_path: Path) -> None:
    mission = MissionRequest(landing_date=date(2027, 1, 10), mission_duration_days=14)
    root = tmp_path / "candidates" / mission.run_id()
    root.mkdir(parents=True)
    (root / "mission.json").write_text(mission.model_dump_json())
    (root / "candidates.json").write_text(
        '{"config":' + plan_search(mission).config.model_dump_json() + "}"
    )
    np.savez(
        root / "sites.npz",
        x_m=[0.0],
        y_m=[0.0],
        ix=[0],
        iy=[0],
        spacing_m=[500.0],
        stage=[1],
        status=[0],
        skipped_mask=[0],
    )
    # An actual 15-degree planar DEM: zero area below the legacy 10-degree price cutoff.
    x = (np.arange(61) - 30) * 80
    heights = np.tile(x * np.tan(np.radians(15)) / 1000, (61, 1)).astype(np.float32)
    dem = PolarDem(heights, PolarGridLabel(61, 61, 80, 30, 30, 1737.4, 0, -90))
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    app.dependency_overrides[get_pricing_dem] = lambda: dem
    response = TestClient(app).get(f"/pricing/runs/{mission.run_id()}?include_cells=true")
    assert response.status_code == 200
    body = response.json()
    assert body["cells"][0]["price"] is not None
    assert body["cells"][0]["excluded_reason"] is None
    assert body["counts"]["priced"] == 1


@pytest.mark.parametrize("limit,status,priced", [(20, 0, 1), (10, 1, 0), (None, 0, 1)])
def test_prices_follow_saved_search_slope_decisions_and_report_the_policy(
    tmp_path: Path, limit: float | None, status: int, priced: int
) -> None:
    mission = MissionRequest(
        landing_date=date(2027, 1, 10),
        mission_duration_days=14,
        max_terrain_slope_degrees=limit,
    )
    root = tmp_path / "candidates" / mission.run_id()
    root.mkdir(parents=True)
    (root / "mission.json").write_text(mission.model_dump_json())
    (root / "candidates.json").write_text(
        '{"config":' + plan_search(mission).config.model_dump_json() + "}"
    )
    np.savez(
        root / "sites.npz",
        x_m=[0.0],
        y_m=[0.0],
        ix=[0],
        iy=[0],
        spacing_m=[500.0],
        stage=[1],
        status=[status],
        skipped_mask=[0],
        terrain_slope_p95_deg=[15.0],
        terrain_coverage_fraction=[1.0],
    )
    x = (np.arange(61) - 30) * 80
    heights = np.tile(x * np.tan(np.radians(15)) / 1000, (61, 1)).astype(np.float32)
    dem = PolarDem(heights, PolarGridLabel(61, 61, 80, 30, 30, 1737.4, 0, -90))
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    app.dependency_overrides[get_pricing_dem] = lambda: dem
    body = TestClient(app).get(f"/pricing/runs/{mission.run_id()}?include_cells=true").json()
    assert body["counts"]["priced"] == priced
    assert body["slope_policy"] == {
        "basis": "saved_search_eligibility",
        "max_slope_degrees": limit,
        "statistic": "p95",
        "assessment_radius_m": 250,
        "slope_baseline_m": 160,
    }


def test_company_comparison_uses_the_selected_search_grid_not_a_second_slope_gate(
    tmp_path: Path,
) -> None:
    mission = MissionRequest(landing_date=date(2027, 1, 10), mission_duration_days=14)
    root = tmp_path / "candidates" / mission.run_id()
    root.mkdir(parents=True)
    (root / "mission.json").write_text(mission.model_dump_json())
    (root / "candidates.json").write_text(
        '{"config":' + plan_search(mission).config.model_dump_json() + "}"
    )
    np.savez(
        root / "sites.npz",
        x_m=[0.0, 500.0],
        y_m=[0.0, 0.0],
        ix=[0, 1],
        iy=[0, 0],
        spacing_m=[500.0, 500.0],
        stage=[1, 1],
        status=[0, 1],
        skipped_mask=[0, 0],
    )
    x = (np.arange(61) - 30) * 80
    heights = np.tile(x * np.tan(np.radians(15)) / 1000, (61, 1)).astype(np.float32)
    dem = PolarDem(heights, PolarGridLabel(61, 61, 80, 30, 30, 1737.4, 0, -90))
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    app.dependency_overrides[get_pricing_dem] = lambda: dem
    client = TestClient(app)
    request = {
        "source_run_id": mission.run_id(),
        "estimate": True,
        "departure_date": "2027-01-06",
        "landing_date": "2027-01-10",
        "mass_kg": 24,
        "delivery": "surface",
        "x_m": 0,
        "y_m": 0,
    }
    response = client.post("/pricing/providers/compare", json=request)
    assert response.status_code == 200
    body = response.json()
    assert body["source_run_id"] == mission.run_id()
    assert body["terrain_excluded_reason"] is None
    assert all("terrain_excluded" not in provider["issues"] for provider in body["providers"])
    excluded = client.post("/pricing/providers/compare", json={**request, "x_m": 500})
    assert excluded.json()["terrain_excluded_reason"] == "search_constraints_not_met"
    invalid = client.post("/pricing/providers/compare", json={**request, "x_m": 1000})
    assert invalid.status_code == 409
