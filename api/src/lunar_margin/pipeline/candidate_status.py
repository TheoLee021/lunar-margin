"""탐색 실행의 진행 상태 파일(status.json). CLI가 쓰고 API가 읽는다."""

import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

STATUS_FILE = "status.json"


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
    if status.state in ("queued", "running") and status.pid is not None and not _alive(status.pid):
        return status.model_copy(
            update={"state": "failed", "error": "탐색 프로세스가 중단되었습니다."}
        )
    return status
