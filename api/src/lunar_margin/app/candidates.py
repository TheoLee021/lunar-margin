"""GET /candidates/runs, /candidates/runs/{id}, /candidates/runs/{id}/layers/{name}.png.

탐색은 오래 걸려서 CLI가 한 번 돌려 DATA_DIR/candidates/{run_id}/에 결과를 쓰고,
여기서는 그 결과를 읽어 돌려준다 (계약: docs/api.md).
"""

import math
import os
import shutil
import subprocess
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi import Path as PathParam
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.engine.candidates.mission import MissionRequest
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.viewshed import visible_grid_fraction
from lunar_margin.pipeline.candidate_schema import (
    CandidateRecord,
    CandidatesDocument,
    MapMeta,
    RunInfo,
    Source,
    Summary,
    SummaryFile,
    WindowSource,
)
from lunar_margin.pipeline.candidate_status import RunStatus, read_status, write_status
from lunar_margin.pipeline.sources import DEM_SOURCES

RUN_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
LAYER_NAME_PATTERN = r"^[a-z_]{1,32}$"

RunId = Annotated[str, PathParam(pattern=RUN_ID_PATTERN)]
LayerName = Annotated[str, PathParam(pattern=LAYER_NAME_PATTERN)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


class RunListItem(BaseModel):
    id: str
    generated_at: str
    dem: str
    window: WindowSource
    selected: int
    sampled_total: int


class RunList(BaseModel):
    runs: list[RunListItem]


class SearchStarted(BaseModel):
    run_id: str
    state: Literal["queued", "running", "done", "failed"]
    cached: bool  # True면 같은 입력의 이전 결과를 그대로 돌려줬다


class StatusOut(BaseModel):
    run_id: str
    state: Literal["queued", "running", "done", "failed"]
    stage: str
    done: int
    total: int
    error: str | None
    started_at: str | None
    updated_at: str
    completed_at: str | None = None
    elapsed_seconds: float | None = None


class RunDetail(BaseModel):
    id: str
    mission: MissionRequest | None  # 사용자 임무 입력으로 만든 실행이면 그 입력
    source: Source
    config: dict[str, object]
    summary: Summary
    run: RunInfo
    map: MapMeta
    candidates: list[CandidateRecord]


# (실행 폴더, run_id, 데이터 폴더) -> 탐색 프로세스의 pid
Launcher = Callable[[Path, str, Path], int]

router = APIRouter(prefix="/candidates", tags=["candidates"])


def _runs_dir(settings: Settings) -> Path:
    return settings.data_dir / "candidates"


def _load(run_dir: Path) -> tuple[CandidatesDocument, SummaryFile, MapMeta]:
    document = CandidatesDocument.model_validate_json((run_dir / "candidates.json").read_text())
    summary = SummaryFile.model_validate_json((run_dir / "summary.json").read_text())
    meta = MapMeta.model_validate_json((run_dir / "map.json").read_text())
    return document, summary, meta


def build_command(mission_path: Path, run_id: str) -> list[str]:
    """탐색 프로세스를 띄우는 명령. 셸을 거치지 않는 인자 목록이라 입력이 해석되지 않는다."""
    command = [
        sys.executable,
        "-m",
        "lunar_margin.pipeline.candidates",
        "--mission",
        str(mission_path),
        "--run-id",
        run_id,
    ]
    config_path = mission_path.parent / "config.json"
    if config_path.is_file():
        command.extend(["--config", str(config_path)])
    return command


def spawn_search(run_dir: Path, run_id: str, data_dir: Path) -> int:
    with (run_dir / "run.log").open("ab") as log:
        process = subprocess.Popen(
            build_command(run_dir / "mission.json", run_id),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,  # 요청이 끝나거나 서버가 재시작돼도 탐색은 계속된다
            env={**os.environ, "DATA_DIR": str(data_dir.resolve())},
        )
    return process.pid


def get_launcher() -> Launcher:
    return spawn_search


LauncherDep = Annotated[Launcher, Depends(get_launcher)]
SEARCH_START_LOCK = threading.Lock()


def is_run_complete(run_dir: Path) -> bool:
    return all(
        (run_dir / name).exists() for name in ("candidates.json", "summary.json", "map.json")
    )


def running_other_than(runs_dir: Path, run_id: str) -> str | None:
    if not runs_dir.is_dir():
        return None
    for other in sorted(runs_dir.iterdir()):
        if other.name == run_id or not other.is_dir():
            continue
        status = read_status(other)
        if status is not None and status.state in ("queued", "running"):
            return other.name
    return None


@router.post("/search")
def start_search(
    mission: MissionRequest,
    response: Response,
    settings: SettingsDep,
    launcher: LauncherDep,
) -> SearchStarted:
    """임무 입력으로 탐색을 시작한다. 같은 입력의 결과가 있으면 다시 계산하지 않는다."""
    return _start_search(mission, response, settings, launcher, development=False)


@router.post("/search/dev")
def start_dev_search(
    mission: MissionRequest, response: Response, settings: SettingsDep, launcher: LauncherDep
) -> SearchStarted:
    """개발 확인용 20 km -> 10 km 탐색. 정밀 후보 탐색 결과와 분리해 저장한다."""
    return _start_search(mission, response, settings, launcher, development=True)


def _start_search(
    mission: MissionRequest,
    response: Response,
    settings: Settings,
    launcher: Launcher,
    *,
    development: bool,
) -> SearchStarted:
    run_id = f"dev-v1-{mission.run_id()}" if development else mission.run_id()
    runs_dir = _runs_dir(settings)
    run_dir = runs_dir / run_id
    with SEARCH_START_LOCK:
        status = read_status(run_dir) if run_dir.is_dir() else None
        if is_run_complete(run_dir) and (status is None or status.state == "done"):
            return SearchStarted(run_id=run_id, state="done", cached=True)
        if status is not None and status.state in ("queued", "running"):
            return SearchStarted(run_id=run_id, state=status.state, cached=False)
        busy = running_other_than(runs_dir, run_id)
        if busy is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "another search is running; try again when it finishes",
                    "running_run_id": busy,
                },
            )
        if run_dir.is_dir():  # 실패했거나 불완전한 이전 결과는 비우고 처음부터
            if run_dir.resolve().parent != runs_dir.resolve():
                raise HTTPException(status_code=500, detail="unexpected run directory")
            shutil.rmtree(run_dir)
        run_dir.mkdir(parents=True)
        (run_dir / "mission.json").write_text(mission.model_dump_json(indent=2) + "\n")
        if development:
            config = SearchConfig(grid_spacing_m=10_000, coarse_spacing_m=20_000, workers=4)
            (run_dir / "config.json").write_text(config.model_dump_json(indent=2) + "\n")
        write_status(run_dir, RunStatus(state="queued", stage="queued", done=0, total=0))
        try:
            pid = launcher(run_dir, run_id, settings.data_dir)
        except OSError as error:
            write_status(
                run_dir,
                RunStatus(state="failed", stage="queued", done=0, total=0, error=str(error)),
            )
            raise HTTPException(status_code=500, detail="could not start the search") from error
        current = read_status(run_dir)
        if (
            current is not None and current.state == "queued"
        ):  # 자식이 먼저 갱신했으면 덮어쓰지 않는다
            write_status(run_dir, current.model_copy(update={"pid": pid}))
    response.status_code = 202
    return SearchStarted(run_id=run_id, state="queued", cached=False)


@router.get("/runs/{run_id}/status")
def get_status(run_id: RunId, settings: SettingsDep) -> StatusOut:
    run_dir = _runs_dir(settings) / run_id
    status = read_status(run_dir) if run_dir.is_dir() else None
    if status is None:
        if run_dir.is_dir() and is_run_complete(run_dir):  # CLI --run-id로 만든 예전 방식의 실행
            status = RunStatus(state="done", stage="done", done=0, total=0)
        else:
            raise HTTPException(status_code=404, detail=f"run '{run_id}' not found")
    return StatusOut(
        run_id=run_id,
        state=status.state,
        stage=status.stage,
        done=status.done,
        total=status.total,
        error=status.error,
        started_at=status.started_at,
        updated_at=status.updated_at,
        completed_at=status.completed_at,
        elapsed_seconds=status.elapsed_seconds,
    )


@router.get("/runs")
def list_runs(settings: SettingsDep) -> RunList:
    runs_dir = _runs_dir(settings)
    items: list[RunListItem] = []
    if runs_dir.is_dir():
        for run_dir in sorted(runs_dir.iterdir()):
            if not run_dir.is_dir():
                continue
            try:
                document, summary, _ = _load(run_dir)
            except OSError, ValueError, ValidationError:
                continue  # 깨진 실행은 목록에서 건너뛴다 (상세 조회에서는 오류로 알린다)
            items.append(
                RunListItem(
                    id=run_dir.name,
                    generated_at=summary.run.generated_at,
                    dem=document.source.dem.name,
                    window=document.source.window,
                    selected=summary.counts.get("selected", 0),
                    sampled_total=summary.counts.get("sampled_total", 0),
                )
            )
    items.sort(key=lambda item: (item.generated_at, item.id), reverse=True)
    return RunList(runs=items)


def _fill_visible_points(document: CandidatesDocument, data_dir: Path) -> None:
    missing = [c for c in document.candidates if c.score.visible_grid_points is None]
    source = DEM_SOURCES.get(document.source.dem.name)
    height = document.config.get("observer_height_m", 0)
    if not missing or source is None or not isinstance(height, (int, float)):
        return
    img, label = source
    try:
        dem = PolarDem.from_files(
            data_dir / "dem" / img.filename, data_dir / "dem" / label.filename
        )
    except OSError, ValueError:
        return
    for candidate in missing:
        fraction = visible_grid_fraction(dem, candidate.x_m, candidate.y_m, height)
        if math.isfinite(fraction):
            candidate.score.visible_grid_points = round(fraction * 120)


@router.get("/runs/{run_id}")
def get_run(run_id: RunId, settings: SettingsDep) -> RunDetail:
    run_dir = _runs_dir(settings) / run_id
    if not run_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"run '{run_id}' not found")
    try:
        document, summary, meta = _load(run_dir)
    except (OSError, ValueError, ValidationError) as error:
        raise HTTPException(
            status_code=500, detail=f"run '{run_id}' has invalid or missing files"
        ) from error
    mission: MissionRequest | None = None
    mission_file = run_dir / "mission.json"
    if mission_file.exists():
        try:
            mission = MissionRequest.model_validate_json(mission_file.read_text())
        except OSError, ValueError, ValidationError:
            mission = None
    status = read_status(run_dir)
    timing = summary.run
    if status is not None:
        timing = timing.model_copy(
            update={
                "total_elapsed_seconds": status.elapsed_seconds,
                "started_at": status.started_at,
                "completed_at": status.completed_at,
            }
        )
    _fill_visible_points(document, settings.data_dir)
    return RunDetail(
        id=run_id,
        mission=mission,
        source=document.source,
        config=document.config,
        summary=document.summary,
        run=timing,
        map=meta,
        candidates=document.candidates,
    )


@router.get("/runs/{run_id}/layers/{name}.png")
def get_layer(run_id: RunId, name: LayerName, settings: SettingsDep) -> FileResponse:
    run_dir = _runs_dir(settings) / run_id
    try:
        meta = MapMeta.model_validate_json((run_dir / "map.json").read_text())
    except (OSError, ValueError, ValidationError) as error:
        raise HTTPException(status_code=404, detail=f"run '{run_id}' not found") from error
    if name not in meta.layers:  # 목록에 있는 이름만 파일로 연결한다
        raise HTTPException(status_code=404, detail=f"layer '{name}' not found")
    return FileResponse(
        run_dir / "layers" / f"{name}.png",
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )
