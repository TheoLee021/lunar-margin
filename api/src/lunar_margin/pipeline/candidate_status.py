"""탐색 실행의 진행 상태 파일(status.json). CLI가 쓰고 API가 읽는다."""

import os
import tempfile
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import TracebackType
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, ValidationError

STATUS_FILE = "status.json"
# 탐색 프로세스는 HEARTBEAT 간격으로 status를 다시 쓴다. 이보다 훨씬 긴 STALE_AFTER 동안
# 갱신이 없으면 프로세스가 죽은 것으로 본다. pid 검사만으로는 좀비 프로세스나 재배포 후
# 재사용된 pid에 속아, 죽은 실행이 계속 "running"으로 남아 새 탐색을 409로 막는다.
HEARTBEAT_SECONDS = 30.0
STALE_AFTER = timedelta(minutes=10)


class RunStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: Literal["queued", "running", "done", "failed"]
    stage: str  # coarse | fine | writing | done ...
    done: int
    total: int
    message: str = ""
    error: str | None = None
    pid: int | None = None  # 탐색 프로세스. 살아 있는지 확인해 중단된 실행을 찾아낸다
    started_at: str | None = None
    updated_at: str = ""
    completed_at: str | None = None
    elapsed_seconds: float | None = None


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def write_status(run_dir: Path, status: RunStatus) -> None:
    """임시 파일에 쓴 뒤 교체해서, 읽는 쪽이 반쯤 쓰인 파일을 보지 않게 한다."""
    run_dir.mkdir(parents=True, exist_ok=True)
    stamped = status.model_copy(update={"updated_at": _now()})
    fd, tmp_name = tempfile.mkstemp(dir=run_dir, prefix=".status-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(stamped.model_dump_json(indent=2) + "\n")
        os.replace(tmp_name, run_dir / STATUS_FILE)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _stale(status: RunStatus) -> bool:
    try:
        updated = datetime.fromisoformat(status.updated_at)
    except ValueError:
        return True
    return datetime.now(UTC) - updated > STALE_AFTER


class StatusKeeper:
    """탐색 프로세스 쪽에서 status를 쓴다. with 블록 안에서는 진행 보고가 없는 구간에도
    HEARTBEAT 간격으로 마지막 상태를 다시 써서, 살아 있는 실행이 STALE_AFTER에 걸리지 않게 한다.
    """

    def __init__(
        self, run_dir: Path, status: RunStatus, *, interval_s: float = HEARTBEAT_SECONDS
    ) -> None:
        self._run_dir = run_dir
        self._status = status
        self._interval_s = interval_s
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._beat, daemon=True)

    def update(self, **fields: object) -> None:
        with self._lock:
            self._status = self._status.model_copy(update=fields)
            write_status(self._run_dir, self._status)

    def _beat(self) -> None:
        while not self._stop.wait(self._interval_s):
            with self._lock:
                write_status(self._run_dir, self._status)

    def __enter__(self) -> Self:
        with self._lock:
            write_status(self._run_dir, self._status)
        self._thread.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self._stop.set()
        self._thread.join()


def read_status(run_dir: Path) -> RunStatus | None:
    path = run_dir / STATUS_FILE
    if not path.exists():
        return None
    try:
        status = RunStatus.model_validate_json(path.read_text())
    except OSError, ValueError, ValidationError:
        return RunStatus(
            state="failed", stage="unknown", done=0, total=0, error="status file is unreadable"
        )
    if status.state not in ("queued", "running"):
        return status
    if status.pid is not None and not _alive(status.pid):
        return status.model_copy(
            update={"state": "failed", "error": "탐색 프로세스가 중단되었습니다."}
        )
    if _stale(status):
        return status.model_copy(
            update={
                "state": "failed",
                "error": "탐색 프로세스가 응답하지 않아 중단된 것으로 처리했습니다.",
            }
        )
    return status
