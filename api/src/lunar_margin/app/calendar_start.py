"""One background job for up to five dates, sharing the candidate-search busy guard."""

import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, TypeAdapter

from lunar_margin.app.candidates import (
    SEARCH_START_LOCK,
    SettingsDep,
    is_run_complete,
    running_other_than,
)
from lunar_margin.app.pricing import CalendarRequest
from lunar_margin.engine.candidates.mission import MissionRequest
from lunar_margin.pipeline.candidate_status import RunStatus, read_status, write_status

router = APIRouter(prefix="/pricing", tags=["pricing"])
CalendarLauncher = Callable[[list[MissionRequest], Path], int]
MISSIONS = TypeAdapter(list[MissionRequest])


class CalendarStarted(BaseModel):
    run_ids: list[str]
    state: Literal["queued", "running", "done"]
    cached: bool


def spawn_calendar(missions: list[MissionRequest], data_dir: Path) -> int:
    first = data_dir / "candidates" / missions[0].run_id()
    job = first / "calendar.json"
    job.write_bytes(MISSIONS.dump_json(missions))
    with (first / "calendar.log").open("ab") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "lunar_margin.pipeline.calendar_job", "--job", str(job)],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
            env={**os.environ, "DATA_DIR": str(data_dir.resolve())},
        )
    return process.pid


def get_calendar_launcher() -> CalendarLauncher:
    return spawn_calendar


@router.post("/calculate")
def start_calendar(
    request: CalendarRequest,
    response: Response,
    settings: SettingsDep,
    launcher: Annotated[CalendarLauncher, Depends(get_calendar_launcher)],
) -> CalendarStarted:
    missions = [
        MissionRequest.model_validate({**request.mission.model_dump(), "landing_date": day})
        for day in request.landing_dates
    ]
    run_ids = [mission.run_id() for mission in missions]
    root = settings.data_dir / "candidates"
    with SEARCH_START_LOCK:
        missing: list[MissionRequest] = []
        for mission in missions:
            folder = root / mission.run_id()
            status = read_status(folder) if folder.is_dir() else None
            if (
                is_run_complete(folder)
                and (folder / "sites.npz").is_file()
                and (status is None or status.state == "done")
            ):
                continue
            missing.append(mission)
        if not missing:
            return CalendarStarted(run_ids=run_ids, state="done", cached=True)
        busy = running_other_than(root, "")
        if busy is not None:
            if busy in run_ids:
                return CalendarStarted(run_ids=run_ids, state="running", cached=False)
            raise HTTPException(
                status_code=409,
                detail={"message": "another search is running", "running_run_id": busy},
            )
        for mission in missing:
            folder = root / mission.run_id()
            if folder.is_dir():
                if folder.resolve().parent != root.resolve():
                    raise HTTPException(status_code=500, detail="unexpected run directory")
                shutil.rmtree(folder)
            folder.mkdir(parents=True)
            (folder / "mission.json").write_text(mission.model_dump_json(indent=2))
            write_status(folder, RunStatus(state="queued", stage="queued", done=0, total=0))
        try:
            pid = launcher(missing, settings.data_dir)
        except OSError as error:
            for mission in missing:
                write_status(
                    root / mission.run_id(),
                    RunStatus(state="failed", stage="queued", done=0, total=0, error=str(error)),
                )
            raise HTTPException(
                status_code=500, detail="could not launch calendar calculation"
            ) from error
        for mission in missing:
            folder = root / mission.run_id()
            status = read_status(folder)
            if status is not None and status.state == "queued":
                write_status(folder, status.model_copy(update={"pid": pid}))
    response.status_code = 202
    return CalendarStarted(run_ids=run_ids, state="queued", cached=False)
