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
