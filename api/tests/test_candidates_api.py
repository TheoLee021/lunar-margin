from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import AnalysisWindow, Roi, SearchConfig
from lunar_margin.pipeline.candidates import run_search, write_outputs

SMALL = SearchConfig(
    roi=Roi(min_lat_deg=-90.0, max_lat_deg=-89.95),
    grid_spacing_m=500.0,
    coarse_spacing_m=1000.0,
    refine_fraction=0.5,
    min_separation_m=1000.0,
    top_k=4,
    window=AnalysisWindow(
        start=datetime(2027, 1, 1, tzinfo=UTC),
        end=datetime(2027, 2, 1, tzinfo=UTC),
        step_minutes=180,
    ),
)


@pytest.fixture(scope="module")
def served(data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    """data_dir/candidates/demo 에 실제 소규모 탐색 결과를 만들어 둔 임시 DATA_DIR."""
    root = tmp_path_factory.mktemp("served")
    write_outputs(run_search(SMALL, data_dir, log=lambda _: None), root / "candidates" / "demo")
    yield root


def client_for(root: Path) -> TestClient:
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=root)
    return TestClient(app)


def test_runs_list_describes_each_run(served: Path) -> None:
    response = client_for(served).get("/candidates/runs")

    assert response.status_code == 200
    (run,) = response.json()["runs"]
    assert run["id"] == "demo" and run["dem"] == "80s_80m"
    assert run["window"]["step_minutes"] == 180
    assert run["selected"] >= 1 and run["sampled_total"] > run["selected"]
    assert run["generated_at"]


def test_run_detail_follows_the_contract(served: Path) -> None:
    response = client_for(served).get("/candidates/runs/demo")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"id", "mission", "source", "config", "summary", "run", "map", "candidates"}
    assert body["config"]["top_k"] == 4
    assert set(body["summary"]) == {"counts", "reasons", "distributions", "warnings"}
    assert body["run"]["workers"] >= 1
    assert body["map"]["layers"][0] == "coarse_sun" and body["map"]["size_px"] > 0
    assert 1 <= len(body["candidates"]) <= 4
    first = body["candidates"][0]
    assert first["rank"] == 1 and first["eligibility"]["status"] == "eligible"
    assert first["data_quality"]["stage"] == "fine"


def test_unrestricted_run_reports_terrain_for_comparison(
    served: Path, data_dir: Path, tmp_path: Path
) -> None:
    (tmp_path / "candidates").symlink_to(served / "candidates", target_is_directory=True)
    (tmp_path / "dem").symlink_to((data_dir / "dem").resolve(), target_is_directory=True)
    body = client_for(tmp_path).get("/candidates/runs/demo").json()
    assert body["config"]["thresholds"]["max_terrain_slope_degrees"] is None
    for candidate in body["candidates"]:
        terrain = candidate["terrain"]
        assert terrain is not None
        assert terrain["coverage_fraction"] == 1
        assert terrain["slope_p95_deg"] > 0
        assert terrain["roughness_p95_m"] > 0


def test_layer_is_served_as_a_png_of_the_map_size(served: Path) -> None:
    from png_decode import decode_png

    client = client_for(served)
    size = client.get("/candidates/runs/demo").json()["map"]["size_px"]

    response = client.get("/candidates/runs/demo/layers/regions.png")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    width, height, _ = decode_png(response.content)
    assert (width, height) == (size, size)


def test_every_layer_listed_in_the_map_meta_can_be_fetched(served: Path) -> None:
    client = client_for(served)
    layers = client.get("/candidates/runs/demo").json()["map"]["layers"]

    statuses = {name: client.get(f"/candidates/runs/demo/layers/{name}.png").status_code
                for name in layers}  # fmt: skip

    assert set(statuses.values()) == {200}


def test_unknown_run_and_unknown_layer_are_404(served: Path) -> None:
    client = client_for(served)

    assert client.get("/candidates/runs/nope").status_code == 404
    assert client.get("/candidates/runs/demo/layers/nope.png").status_code == 404
    assert client.get("/candidates/runs/nope/layers/sun.png").status_code == 404


@pytest.mark.parametrize("bad", ["bad.id", "a b", "x" * 65, "%2e%2e", "demo;rm"])
def test_malformed_run_id_is_422_and_never_touches_the_filesystem(served: Path, bad: str) -> None:
    assert client_for(served).get(f"/candidates/runs/{bad}").status_code == 422


def test_layer_name_cannot_escape_the_layers_directory(served: Path) -> None:
    client = client_for(served)

    for bad in ("..%2fsummary", "%2e%2e%2fcandidates", "sun.png.bak"):
        assert client.get(f"/candidates/runs/demo/layers/{bad}.png").status_code in {404, 422}


def test_no_runs_directory_means_an_empty_list_not_an_error(tmp_path: Path) -> None:
    response = client_for(tmp_path).get("/candidates/runs")

    assert response.status_code == 200 and response.json() == {"runs": []}


def test_a_corrupt_run_is_reported_clearly(served: Path, tmp_path: Path) -> None:
    broken = tmp_path / "candidates" / "broken"
    broken.mkdir(parents=True)
    (broken / "candidates.json").write_text("{not json")
    (broken / "summary.json").write_text("{}")
    (broken / "map.json").write_text("{}")

    client = client_for(tmp_path)

    assert client.get("/candidates/runs/broken").status_code == 500
    assert "broken" in client.get("/candidates/runs/broken").json()["detail"]
    assert client.get("/candidates/runs").json() == {"runs": []}  # 목록에서는 건너뛴다


# --- 임무 입력으로 탐색 시작 + 진행 상태 -----------------------------------------------

import shutil  # noqa: E402

from lunar_margin.app.candidates import (  # noqa: E402
    build_command,
    get_launcher,
)
from lunar_margin.engine.candidates.mission import MissionRequest  # noqa: E402
from lunar_margin.pipeline.candidate_status import RunStatus, read_status, write_status  # noqa: E402

EXAMPLE_MISSION = {
    "landing_date": "2027-01-01",
    "mission_duration_days": 14,
    "max_continuous_darkness_hours": 24,
    "max_communication_blackout_hours": 6,
    "max_terrain_slope_degrees": 10,
    "search_region": "south",
    "optimization_priority": "balanced",
    "observer_height_m": None,
}


class FakeLauncher:
    """탐색 프로세스를 실제로 띄우지 않고 호출만 기록한다."""

    def __init__(self) -> None:
        self.launched: list[str] = []

    def __call__(self, run_dir: Path, run_id: str, data_dir: Path) -> int:
        self.launched.append(run_id)
        import os

        return os.getpid()  # 살아 있는 pid: 실행 중으로 보인다


def search_client(root: Path, launcher: FakeLauncher) -> TestClient:
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=root)
    app.dependency_overrides[get_launcher] = lambda: launcher
    return TestClient(app)


def test_posting_a_mission_starts_one_search_and_returns_its_run_id(tmp_path: Path) -> None:
    launcher = FakeLauncher()

    response = search_client(tmp_path, launcher).post("/candidates/search", json=EXAMPLE_MISSION)

    run_id = MissionRequest.model_validate(EXAMPLE_MISSION).run_id()
    assert response.status_code == 202
    assert response.json() == {"run_id": run_id, "state": "queued", "cached": False}
    assert launcher.launched == [run_id]
    run_dir = tmp_path / "candidates" / run_id
    assert (run_dir / "mission.json").exists()
    status = read_status(run_dir)
    assert status is not None and status.state == "queued"


def test_the_same_mission_while_running_does_not_start_a_second_search(tmp_path: Path) -> None:
    launcher = FakeLauncher()
    client = search_client(tmp_path, launcher)

    first = client.post("/candidates/search", json=EXAMPLE_MISSION)
    second = client.post("/candidates/search", json=EXAMPLE_MISSION)

    assert second.status_code == 200
    assert second.json()["run_id"] == first.json()["run_id"] and second.json()["cached"] is False
    assert launcher.launched == [first.json()["run_id"]]


def test_a_finished_identical_mission_is_served_from_the_previous_result(
    served: Path, tmp_path: Path
) -> None:
    run_id = MissionRequest.model_validate(EXAMPLE_MISSION).run_id()
    shutil.copytree(served / "candidates" / "demo", tmp_path / "candidates" / run_id)
    write_status(
        tmp_path / "candidates" / run_id,
        RunStatus(state="done", stage="done", done=5, total=5),
    )
    launcher = FakeLauncher()

    response = search_client(tmp_path, launcher).post("/candidates/search", json=EXAMPLE_MISSION)

    assert response.status_code == 200
    assert response.json() == {"run_id": run_id, "state": "done", "cached": True}
    assert launcher.launched == []


def test_a_different_mission_is_refused_while_another_search_is_running(tmp_path: Path) -> None:
    launcher = FakeLauncher()
    client = search_client(tmp_path, launcher)
    client.post("/candidates/search", json=EXAMPLE_MISSION)

    other = client.post("/candidates/search", json={**EXAMPLE_MISSION, "mission_duration_days": 7})

    assert other.status_code == 409
    assert "running" in other.json()["detail"]["message"]
    assert other.json()["detail"]["running_run_id"] == launcher.launched[0]
    assert len(launcher.launched) == 1


def test_a_run_that_stopped_updating_does_not_block_new_searches(tmp_path: Path) -> None:
    from datetime import UTC, datetime, timedelta

    from lunar_margin.pipeline.candidate_status import STALE_AFTER

    stuck = tmp_path / "candidates" / "m-stuck"
    stuck.mkdir(parents=True)
    import os

    # 프로세스는 SIGKILL로 죽었지만 pid가 살아 있어 보이는 상황 (좀비, pid 재사용)
    updated = datetime.now(UTC) - STALE_AFTER - timedelta(minutes=1)
    (stuck / "status.json").write_text(
        RunStatus(
            state="running",
            stage="fine",
            done=1,
            total=9,
            pid=os.getpid(),
            updated_at=updated.isoformat(timespec="seconds"),
        ).model_dump_json()
    )
    launcher = FakeLauncher()

    response = search_client(tmp_path, launcher).post("/candidates/search", json=EXAMPLE_MISSION)

    assert response.status_code == 202
    assert len(launcher.launched) == 1


def test_a_failed_run_can_be_started_again_from_a_clean_directory(tmp_path: Path) -> None:
    run_id = MissionRequest.model_validate(EXAMPLE_MISSION).run_id()
    run_dir = tmp_path / "candidates" / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "stale.txt").write_text("old partial output")
    write_status(run_dir, RunStatus(state="failed", stage="fine", done=1, total=9, error="boom"))
    launcher = FakeLauncher()

    response = search_client(tmp_path, launcher).post("/candidates/search", json=EXAMPLE_MISSION)

    assert response.status_code == 202 and launcher.launched == [run_id]
    assert not (run_dir / "stale.txt").exists()


@pytest.mark.parametrize(
    "bad",
    [
        {"mission_duration_days": 0},
        {"landing_date": "2027-13-40"},
        {"max_continuous_darkness_hours": -3},
        {"optimization_priority": "fast"},
        {"unknown": 1},
    ],
)
def test_invalid_mission_input_is_422_and_starts_nothing(
    tmp_path: Path, bad: dict[str, object]
) -> None:
    launcher = FakeLauncher()

    response = search_client(tmp_path, launcher).post(
        "/candidates/search", json={**EXAMPLE_MISSION, **bad}
    )

    assert response.status_code == 422 and launcher.launched == []


def test_global_search_is_refused_with_a_clear_message(tmp_path: Path) -> None:
    response = search_client(tmp_path, FakeLauncher()).post(
        "/candidates/search", json={**EXAMPLE_MISSION, "search_region": "global"}
    )

    assert response.status_code == 422 and "planned" in response.text


def test_status_endpoint_reports_progress_and_errors(tmp_path: Path) -> None:
    run_dir = tmp_path / "candidates" / "m-abc"
    write_status(run_dir, RunStatus(state="running", stage="fine", done=300, total=1200))
    client = search_client(tmp_path, FakeLauncher())

    body = client.get("/candidates/runs/m-abc/status").json()

    assert body["state"] == "running" and body["stage"] == "fine"
    assert (body["done"], body["total"]) == (300, 1200)
    assert "pid" not in body  # 내부 정보는 내보내지 않는다

    write_status(run_dir, RunStatus(state="failed", stage="fine", done=1, total=2, error="boom"))
    assert client.get("/candidates/runs/m-abc/status").json()["error"] == "boom"


def test_status_for_an_unknown_run_is_404_and_a_bad_id_is_422(tmp_path: Path) -> None:
    client = search_client(tmp_path, FakeLauncher())

    assert client.get("/candidates/runs/nope/status").status_code == 404
    assert client.get("/candidates/runs/bad.id/status").status_code == 422


def test_a_finished_run_reports_done_even_without_a_status_file(served: Path) -> None:
    # 예전 방식(CLI --run-id)으로 만든 실행은 status.json이 없다
    body = client_for(served).get("/candidates/runs/demo/status").json()

    assert body["state"] == "done"


def test_run_detail_includes_the_mission_when_the_run_came_from_one(
    served: Path, tmp_path: Path
) -> None:
    run_id = MissionRequest.model_validate(EXAMPLE_MISSION).run_id()
    shutil.copytree(served / "candidates" / "demo", tmp_path / "candidates" / run_id)
    (tmp_path / "candidates" / run_id / "mission.json").write_text(
        MissionRequest.model_validate(EXAMPLE_MISSION).model_dump_json()
    )

    body = client_for(tmp_path).get(f"/candidates/runs/{run_id}").json()

    assert body["mission"]["mission_duration_days"] == 14
    assert client_for(served).get("/candidates/runs/demo").json()["mission"] is None


def test_the_launch_command_is_an_argument_list_without_a_shell(tmp_path: Path) -> None:
    command = build_command(tmp_path / "m-abc" / "mission.json", "m-abc")

    assert command[1:3] == ["-m", "lunar_margin.pipeline.candidates"]
    assert command[command.index("--run-id") + 1] == "m-abc"
    assert command[command.index("--mission") + 1].endswith("m-abc/mission.json")
    assert all(isinstance(part, str) for part in command)


def test_dev_search_has_separate_identity_and_persisted_coarse_config(tmp_path: Path) -> None:
    launcher = FakeLauncher()
    response = search_client(tmp_path, launcher).post(
        "/candidates/search/dev", json=EXAMPLE_MISSION
    )
    assert response.status_code == 202
    run_id = response.json()["run_id"]
    assert run_id.startswith("dev-")
    assert run_id != MissionRequest.model_validate(EXAMPLE_MISSION).run_id()
    config_path = tmp_path / "candidates" / run_id / "config.json"
    config = SearchConfig.model_validate_json(config_path.read_text())
    assert config.grid_spacing_m == 10_000
    assert config.coarse_spacing_m == 20_000
    assert config.roi.max_lat_deg == -85
    assert config.min_separation_m == 2000
    command = build_command(config_path.parent / "mission.json", run_id)
    assert command[command.index("--config") + 1] == str(config_path)


def test_dev_reuses_its_own_running_request_and_shares_busy_guard(tmp_path: Path) -> None:
    launcher = FakeLauncher()
    client = search_client(tmp_path, launcher)
    first = client.post("/candidates/search/dev", json=EXAMPLE_MISSION)
    again = client.post("/candidates/search/dev", json=EXAMPLE_MISSION)
    assert first.status_code == 202 and again.status_code == 200
    assert first.json()["run_id"] == again.json()["run_id"]
    assert len(launcher.launched) == 1
    assert client.post("/candidates/search", json=EXAMPLE_MISSION).status_code == 409


def test_status_exposes_recorded_timing_without_restarting_the_clock(tmp_path: Path) -> None:
    write_status(
        tmp_path / "candidates" / "timed",
        RunStatus(
            state="done",
            stage="done",
            done=10,
            total=10,
            started_at="2026-11-14T20:00:00+00:00",
            completed_at="2026-11-14T20:00:12+00:00",
            elapsed_seconds=12.25,
        ),
    )
    body = client_for(tmp_path).get("/candidates/runs/timed/status").json()
    assert body["elapsed_seconds"] == 12.25
    assert body["completed_at"] == "2026-11-14T20:00:12+00:00"


def test_saved_rf_result_is_preserved_for_separate_margin_display(
    served: Path, tmp_path: Path
) -> None:
    import json
    import shutil

    root = tmp_path / "input"
    shutil.copytree(served, root)
    path = root / "candidates/demo/candidates.json"
    doc = json.loads(path.read_text())
    doc["candidates"][0]["rf"] = {
        "fraction": 0.8,
        "longest_blackout_hours": 6,
        "min_link_margin_db": 15.688618,
        "required_ebn0_db": 0.745886,
        "rx_required_dbw": -144.144136,
        "evaluation_hours": 24,
        "available_hours": 19.2,
    }
    doc["candidates"][0]["score"].update(
        communication_basis="nominal_rf", communication_component=0.8
    )
    path.write_text(json.dumps(doc))
    response = client_for(root).get("/candidates/runs/demo")
    assert response.status_code == 200
    assert response.json()["candidates"][0]["rf"]["min_link_margin_db"] == 15.688618
