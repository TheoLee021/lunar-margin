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
    MISSIONS,
    SFN_FEED,
    SFN_URL,
    Launch,
    merge_launches,
    parse_sfn,
    parse_sls,
)
from lunar_margin.engine.provider_pricing import Model

router = APIRouter(prefix="/pricing/providers", tags=["provider pricing"])


class SourceState(Model):
    name: str
    url: str
    fetched_at: datetime
    stale: bool = False
    error: str | None = None


class LaunchSchedule(Model):
    launches: list[Launch]
    sources: list[SourceState]
    timezone: str = Field(default="UTC", pattern="^UTC$")


def download(url: str) -> str:
    with urlopen(
        Request(url, headers={"User-Agent": "LunarMargin/1.0 (launch schedule reader)"}), timeout=5
    ) as response:
        body = response.read(4_000_001)
    if len(body) > 4_000_000:
        raise ValueError("Schedule response exceeds size limit")
    return body.decode("utf-8")


class ScheduleReader:
    def __init__(self) -> None:
        self.lock = Lock()
        self.expires = 0.0
        self.data = LaunchSchedule.model_validate_json(
            files("lunar_margin").joinpath("launch_schedule.json").read_text()
        )

    def read(self) -> LaunchSchedule:
        with self.lock:
            if time.monotonic() < self.expires:
                return self.data
            targets = [("Spaceflight Now", SFN_FEED, None)] + [
                ("Space Launch Schedule", values[2], key) for key, values in MISSIONS.items()
            ]
            records: list[Launch] = []
            states: list[SourceState] = []
            with ThreadPoolExecutor(max_workers=3) as pool:
                pending = [
                    (name, url, mission, pool.submit(download, url))
                    for name, url, mission in targets
                ]
                for name, url, mission, future in pending:
                    try:
                        body = future.result()
                        parsed = parse_sfn(body) if mission is None else [parse_sls(body, mission)]
                        if not parsed:
                            raise ValueError("No supported lunar missions in source")
                        records.extend(parsed)
                        states.append(
                            SourceState(
                                name=name,
                                url=SFN_URL if mission is None else url,
                                fetched_at=datetime.now(UTC),
                            )
                        )
                    except (OSError, ValueError) as error:
                        previous_sources = [
                            s
                            for s in self.data.sources
                            if s.url == (SFN_URL if mission is None else url)
                        ]
                        stamp = (
                            previous_sources[0].fetched_at
                            if previous_sources
                            else datetime.now(UTC)
                        )
                        states.append(
                            SourceState(
                                name=name,
                                url=SFN_URL if mission is None else url,
                                fetched_at=stamp,
                                stale=True,
                                error=f"일정 갱신 실패 ({type(error).__name__}) · 마지막 확인 자료",
                            )
                        )
                        for item in self.data.launches:
                            sources = [
                                s
                                for s in item.sources
                                if s.url == (SFN_URL if mission is None else url)
                            ]
                            if sources:
                                records.append(item.model_copy(update={"sources": sources}))
            self.data = LaunchSchedule(launches=merge_launches(records), sources=states)
            self.expires = time.monotonic() + 600
            return self.data


@lru_cache(maxsize=1)
def get_reader() -> ScheduleReader:
    return ScheduleReader()


@router.get("/launches")
def get_launches() -> LaunchSchedule:
    return get_reader().read()
