import json
import os
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from lunar_margin.pipeline.candidate_status import (
    STALE_AFTER,
    RunStatus,
    StatusKeeper,
    read_status,
    write_status,
)


def _write_as_of(run_dir: Path, status: RunStatus, updated: datetime) -> None:
    """write_status는 지금 시각을 찍으므로, 지난 시각의 기록은 파일을 직접 쓴다."""
    stamped = status.model_copy(update={"updated_at": updated.isoformat(timespec="seconds")})
    (run_dir / "status.json").write_text(stamped.model_dump_json())


def _long_ago() -> datetime:
    return datetime.now(UTC) - STALE_AFTER - timedelta(minutes=1)


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


@pytest.mark.parametrize("state", ["queued", "running"])
def test_an_unfinished_status_that_stopped_updating_is_reported_as_failed(
    tmp_path: Path, state: str
) -> None:
    # pid가 살아 있어 보여도(좀비, 재배포 후 pid 재사용) 갱신이 멈췄으면 중단된 것이다
    _write_as_of(
        tmp_path,
        RunStatus.model_validate(
            {"state": state, "stage": "fine", "done": 1, "total": 9, "pid": os.getpid()}
        ),
        _long_ago(),
    )

    status = read_status(tmp_path)

    assert status is not None and status.state == "failed"
    assert "응답" in (status.error or "")


def test_a_recently_updated_status_stays_running(tmp_path: Path) -> None:
    _write_as_of(
        tmp_path,
        RunStatus(state="running", stage="fine", done=1, total=9, pid=os.getpid()),
        datetime.now(UTC) - STALE_AFTER + timedelta(minutes=1),
    )

    status = read_status(tmp_path)

    assert status is not None and status.state == "running"


def test_an_old_finished_status_is_not_reported_as_failed(tmp_path: Path) -> None:
    _write_as_of(tmp_path, RunStatus(state="done", stage="done", done=9, total=9), _long_ago())

    status = read_status(tmp_path)

    assert status is not None and status.state == "done"


def _wait_until(condition: Callable[[], bool], timeout_s: float = 2.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.01)
    return condition()


def test_the_keeper_refreshes_the_status_while_no_progress_is_reported(tmp_path: Path) -> None:
    start = RunStatus(state="running", stage="writing", done=0, total=0, pid=os.getpid())
    with StatusKeeper(tmp_path, start, interval_s=0.02):
        # 진행 보고 없이 오래 걸리는 구간을 흉내 낸다: 기록을 지난 시각으로 되돌려 둔다
        _write_as_of(tmp_path, start, _long_ago())

        def refreshed() -> bool:
            status = read_status(tmp_path)
            return status is not None and status.state == "running"

        assert _wait_until(refreshed)


def test_the_keeper_writes_updates_and_stops_refreshing_after_exit(tmp_path: Path) -> None:
    start = RunStatus(state="running", stage="starting", done=0, total=0)
    with StatusKeeper(tmp_path, start, interval_s=0.02) as keeper:
        keeper.update(stage="fine", done=3, total=9)
        progressed = read_status(tmp_path)
        assert progressed is not None and (progressed.stage, progressed.done) == ("fine", 3)
        keeper.update(state="done", stage="done")
    old = RunStatus(state="running", stage="x", done=0, total=0)
    _write_as_of(tmp_path, old, _long_ago())
    time.sleep(0.1)

    status = read_status(tmp_path)

    assert status is not None and status.state == "failed"  # 나간 뒤에는 다시 쓰지 않는다
