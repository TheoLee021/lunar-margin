"""Bounded parallel refresh, with a dated snapshot when a public source is unavailable."""

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from functools import lru_cache
from importlib.resources import files
from threading import Lock
from urllib.request import Request, urlopen

from fastapi import APIRouter
from pydantic import Field

from lunar_margin.engine.launch_schedule import (
    SFN_FEED,
    SFN_URL,
    Feed,
    Launch,
    merge_launches,
    parse_sfn,
)
from lunar_margin.engine.provider_pricing import Model
from lunar_margin.pipeline.launch_sources import Collected, Fetched, collect_sls

router = APIRouter(prefix="/pricing/providers", tags=["provider pricing"])


class SourceState(Model):
    name: str
    url: str
    fetched_at: datetime
    stale: bool = False
    error: str | None = None
    scanned_records: int = 0
    scanned_pages: int = 0
    complete: bool = True


class LaunchSchedule(Model):
    launches: list[Launch]
    sources: list[SourceState]
    scope: str = "all_launches_demo"
    timezone: str = Field(default="UTC", pattern="^UTC$")


def download(url: str) -> Fetched:
    with urlopen(
        Request(url, headers={"User-Agent": "LunarMargin/1.0 (launch schedule reader)"}), timeout=5
    ) as response:
        body = response.read(4_000_001)
        pages = int(response.headers.get("X-WP-TotalPages", "1"))
    if len(body) > 4_000_000:
        raise ValueError("Schedule response exceeds size limit")
    return Fetched(body.decode("utf-8-sig"), pages)


class ScheduleReader:
    def __init__(self) -> None:
        self.lock = Lock()
        self.expires = 0.0
        self.data = LaunchSchedule.model_validate_json(
            files("lunar_margin").joinpath("launch_schedule.json").read_text()
        )

    def peek(self) -> LaunchSchedule:
        """Read the immutable last result without waiting for an external refresh."""
        return self.data

    def read(self) -> LaunchSchedule:
        if time.monotonic() < self.expires:
            return self.data
        if not self.lock.acquire(blocking=False):
            previous = self.data
            return previous.model_copy(
                update={
                    "sources": [
                        source.model_copy(
                            update={
                                "stale": True,
                                "error": source.error or "일정 갱신 중 · 마지막 확인 자료",
                            }
                        )
                        for source in previous.sources
                    ]
                }
            )
        try:
            if time.monotonic() < self.expires:
                return self.data
            records: list[Launch] = []
            states: list[SourceState] = []

            def sfn() -> Collected:
                body = download(SFN_FEED).text
                return Collected(
                    parse_sfn(body, all_launches=True),
                    len(Feed.model_validate_json(body).launches),
                    1,
                )

            with ThreadPoolExecutor(max_workers=2) as pool:
                pending = [
                    ("Spaceflight Now", SFN_URL, pool.submit(sfn)),
                    (
                        "Space Launch Schedule",
                        "https://www.spacelaunchschedule.com/",
                        pool.submit(
                            collect_sls, download, datetime.now(UTC).date(), all_launches=True
                        ),
                    ),
                ]
                for name, url, future in pending:
                    try:
                        result = future.result()
                        records.extend(result.launches)
                        states.append(
                            SourceState(
                                name=name,
                                url=url,
                                fetched_at=datetime.now(UTC),
                                scanned_records=result.scanned_records,
                                scanned_pages=result.scanned_pages,
                            )
                        )
                    except (OSError, ValueError) as error:
                        previous = next(
                            (state for state in self.data.sources if state.name == name), None
                        )
                        states.append(
                            SourceState(
                                name=name,
                                url=url,
                                fetched_at=previous.fetched_at if previous else datetime.now(UTC),
                                stale=True,
                                complete=False,
                                error=f"전체 수집 실패 ({type(error).__name__}) · 마지막 확인 자료",
                            )
                        )
                        for item in self.data.launches:
                            sources = [source for source in item.sources if source.name == name]
                            if sources:
                                records.append(item.model_copy(update={"sources": sources}))
            self.data = LaunchSchedule(launches=merge_launches(records), sources=states)
            self.expires = time.monotonic() + 600
            return self.data
        finally:
            self.lock.release()


@lru_cache(maxsize=1)
def get_reader() -> ScheduleReader:
    return ScheduleReader()


@router.get("/launches")
def get_launches() -> LaunchSchedule:
    return get_reader().read()
