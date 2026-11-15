import os
from pathlib import Path

from fastapi.testclient import TestClient

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.calendar_start import get_calendar_launcher
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.mission import MissionRequest
from lunar_margin.pipeline.candidate_status import RunStatus, write_status


def test_an_unrelated_search_blocks_calendar_without_starting_another_job(tmp_path: Path) -> None:
    write_status(
        tmp_path / "candidates" / "unrelated",
        RunStatus(state="running", stage="fine", done=1, total=2, pid=os.getpid()),
    )
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    response = TestClient(app).post(
        "/pricing/calculate",
        json={
            "mission": {"landing_date": "2027-01-08", "mission_duration_days": 14},
            "landing_dates": ["2027-01-08"],
            "mass_kg": 24,
            "delivery": "surface",
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["running_run_id"] == "unrelated"


def test_failed_batch_launch_marks_every_date_failed(tmp_path: Path) -> None:
    def fail(missions: list[MissionRequest], data_dir: Path) -> int:
        raise OSError("cannot launch")

    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    app.dependency_overrides[get_calendar_launcher] = lambda: fail
    client = TestClient(app)
    response = client.post(
        "/pricing/calculate",
        json={
            "mission": {"landing_date": "2027-01-08", "mission_duration_days": 14},
            "landing_dates": ["2027-01-08", "2027-01-09"],
            "mass_kg": 24,
            "delivery": "surface",
        },
    )
    assert response.status_code == 500
    for folder in (tmp_path / "candidates").iterdir():
        assert client.get(f"/candidates/runs/{folder.name}/status").json()["state"] == "failed"


def test_calendar_starts_one_batch_and_reuses_running_batch(tmp_path: Path) -> None:
    launches: list[list[str]] = []

    def launch(missions: list[MissionRequest], data_dir: Path) -> int:
        launches.append([str(m.landing_date) for m in missions])
        return os.getpid()

    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    app.dependency_overrides[get_calendar_launcher] = lambda: launch
    client = TestClient(app)
    request = {
        "mission": {"landing_date": "2027-01-08", "mission_duration_days": 14},
        "landing_dates": [f"2027-01-{d:02d}" for d in range(8, 13)],
        "mass_kg": 24,
        "delivery": "surface",
    }
    first = client.post("/pricing/calculate", json=request)
    assert first.status_code == 202
    assert len(first.json()["run_ids"]) == 5
    again = client.post("/pricing/calculate", json=request)
    assert again.status_code == 200 and again.json()["state"] == "running"
    assert len(launches) == 1
    # The standard search guard must also see this batch.
    busy = client.post(
        "/candidates/search", json={"landing_date": "2027-02-01", "mission_duration_days": 14}
    )
    assert busy.status_code == 409
