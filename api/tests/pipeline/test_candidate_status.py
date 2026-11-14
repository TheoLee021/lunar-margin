import json
import os
from pathlib import Path

import pytest

from lunar_margin.pipeline.candidate_status import (
    RunStatus,
    read_status,
    write_status,
)


def test_status_round_trips(tmp_path: Path) -> None:
    write_status(tmp_path, RunStatus(state="running", stage="fine", done=10, total=40))

    status = read_status(tmp_path)

    assert status is not None
    assert (status.state, status.stage, status.done, status.total) == ("running", "fine", 10, 40)
    assert status.updated_at  # 쓸 때마다 갱신된다


def test_missing_status_file_reads_as_none(tmp_path: Path) -> None:
    assert read_status(tmp_path) is None


def test_write_replaces_the_file_atomically_and_leaves_no_temp_files(tmp_path: Path) -> None:
    for done in range(5):
        write_status(tmp_path, RunStatus(state="running", stage="coarse", done=done, total=5))

    assert sorted(p.name for p in tmp_path.iterdir()) == ["status.json"]
    assert json.loads((tmp_path / "status.json").read_text())["done"] == 4


def test_corrupt_status_is_reported_as_failed_not_crashed(tmp_path: Path) -> None:
    (tmp_path / "status.json").write_text("{broken")

    status = read_status(tmp_path)

    assert status is not None and status.state == "failed"
    assert "status" in (status.error or "")


def test_a_running_status_with_a_dead_process_is_reported_as_failed(tmp_path: Path) -> None:
    dead_pid = 2**22 + 12345  # 존재하지 않을 만큼 큰 pid
    write_status(tmp_path, RunStatus(state="running", stage="fine", done=1, total=9, pid=dead_pid))

    status = read_status(tmp_path)

    assert status is not None and status.state == "failed"
    assert "중단" in (status.error or "")


def test_a_running_status_with_a_live_process_stays_running(tmp_path: Path) -> None:
    write_status(
        tmp_path, RunStatus(state="running", stage="fine", done=1, total=9, pid=os.getpid())
    )

    status = read_status(tmp_path)

    assert status is not None and status.state == "running"


def test_finished_states_are_never_second_guessed(tmp_path: Path) -> None:
    write_status(tmp_path, RunStatus(state="done", stage="done", done=9, total=9, pid=2**22 + 7))

    status = read_status(tmp_path)

    assert status is not None and status.state == "done"


def test_state_must_be_a_known_value(tmp_path: Path) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        RunStatus.model_validate({"state": "sleeping", "stage": "x", "done": 0, "total": 0})
