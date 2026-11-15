"""Background calendar calculation; results remain standard #13 candidate runs."""

import argparse
import os
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from pydantic import TypeAdapter

from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.mission import MissionRequest, plan_search
from lunar_margin.pipeline.calendar_search import run_search_batch
from lunar_margin.pipeline.candidate_status import RunStatus, StatusKeeper, read_status
from lunar_margin.pipeline.candidates import write_outputs


def run_calendar(missions: list[MissionRequest], data_dir: Path) -> None:
    started = time.perf_counter()
    plans = [plan_search(mission) for mission in missions]
    folders = [data_dir / "candidates" / mission.run_id() for mission in missions]
    keepers: list[StatusKeeper] = []
    last_update = [0.0]
    with ExitStack() as stack:
        for folder in folders:
            keepers.append(
                stack.enter_context(
                    StatusKeeper(
                        folder,
                        RunStatus(
                            state="running",
                            stage="starting",
                            done=0,
                            total=0,
                            pid=os.getpid(),
                            started_at=datetime.now(UTC).isoformat(timespec="seconds"),
                        ),
                    )
                )
            )

        def progress(stage: str, done: int, total: int) -> None:
            now = time.perf_counter()
            if done != total and now - last_update[0] < 0.25:
                return
            last_update[0] = now
            for keeper in keepers:
                keeper.update(stage=stage, done=done, total=total, elapsed_seconds=now - started)

        try:
            outcomes = run_search_batch(
                [plan.config for plan in plans],
                data_dir,
                progress=progress,
                extra_warnings=[plan.warnings for plan in plans],
            )

            def export(i: int) -> None:
                folder, outcome, keeper = folders[i], outcomes[i], keepers[i]
                keeper.update(stage="writing")
                outcome = replace(
                    outcome,
                    run=outcome.run.model_copy(
                        update={"elapsed_seconds": time.perf_counter() - started}
                    ),
                )
                write_outputs(outcome, folder)
                count = outcome.summary.counts["sampled_total"]
                keeper.update(
                    state="done",
                    stage="done",
                    done=count,
                    total=count,
                    completed_at=datetime.now(UTC).isoformat(),
                    elapsed_seconds=time.perf_counter() - started,
                )

            with ThreadPoolExecutor(max_workers=min(3, len(outcomes))) as pool:
                for _ in pool.map(export, range(len(outcomes))):
                    pass
        except BaseException as error:
            for i, keeper in enumerate(keepers):
                status = read_status(folders[i])
                if status is None or status.state != "done":
                    keeper.update(
                        state="failed",
                        stage="failed",
                        error=str(error),
                        completed_at=datetime.now(UTC).isoformat(),
                        elapsed_seconds=time.perf_counter() - started,
                    )
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", type=Path, required=True)
    args = parser.parse_args()
    missions = TypeAdapter(list[MissionRequest]).validate_json(args.job.read_bytes())
    if not 1 <= len(missions) <= 5:
        raise ValueError("calendar job requires 1..5 dates")
    run_calendar(missions, Settings().data_dir)


if __name__ == "__main__":
    main()
