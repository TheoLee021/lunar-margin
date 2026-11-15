"""Read only public schedule feeds; preserve NET/TBD and month precision."""

import re
from datetime import UTC, date, datetime
from html.parser import HTMLParser
from typing import Literal

from pydantic import BaseModel, Field

from lunar_margin.engine.provider_pricing import Model, ProviderId

SFN_URL = "https://spaceflightnow.com/launch-schedule/"
SFN_FEED = "https://spaceflightnow.com/wp-content/uploads/sfn-launch/upcoming.json"
SLS_URL = "https://www.spacelaunchschedule.com/"
MISSIONS: dict[str, tuple[ProviderId, str, str]] = {
    "griffin-1": (
        "voyager",
        "Griffin Mission One · Falcon Heavy",
        SLS_URL + "launch/falcon-heavy-griffin-mission-one/",
    ),
    "blue-moon-pathfinder": (
        "blue_origin",
        "Blue Moon Pathfinder · New Glenn",
        SLS_URL + "launch/new-glenn-blue-moon-pathfinder/",
    ),
}


class LaunchSource(Model):
    name: Literal["Spaceflight Now", "Space Launch Schedule"]
    url: str
    label: str


class Launch(Model):
    id: str
    provider_id: ProviderId
    name: str
    departure_date: date | None = None
    label: str
    confirmed: Literal[False] = False
    sources: list[LaunchSource]


class FeedLaunch(BaseModel):
    mission_name: str
    launch_date_label: str = "TBD"
    launch_date_iso: datetime | None = None
    net_month_only: bool = False
    net_date_only: bool = False
    date_tbd: bool = False


class Feed(BaseModel):
    launches: list[FeedLaunch]


def has_calendar_day(label: str) -> bool:
    return bool(
        re.search(
            r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b",
            label,
        )
    )


def parse_sfn(text: str) -> list[Launch]:
    records: list[Launch] = []
    for item in Feed.model_validate_json(text).launches:
        name = item.mission_name.lower()
        mission = (
            "griffin-1"
            if "griffin" in name and re.search(r"\b(1|one)\b", name)
            else "blue-moon-pathfinder"
            if "blue moon" in name and "pathfinder" in name
            else None
        )
        if mission is None:
            continue
        provider, label, _ = MISSIONS[mission]
        day = (
            item.launch_date_iso.astimezone(UTC).date()
            if item.launch_date_iso
            and not item.net_month_only
            and not item.date_tbd
            and has_calendar_day(item.launch_date_label)
            else None
        )
        records.append(
            Launch(
                id=mission,
                provider_id=provider,
                name=label,
                departure_date=day,
                label=item.launch_date_label + " · 잠정 일정",
                sources=[
                    LaunchSource(name="Spaceflight Now", url=SFN_URL, label=item.launch_date_label)
                ],
            )
        )
    return records


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.text: list[str] = []
        self.scripts: list[str] = []
        self.hidden = False
        self.structured = False
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self.hidden = True
            self.structured = dict(attrs).get("type") == "application/ld+json"
            self.chunks = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            if self.structured:
                self.scripts.append("".join(self.chunks))
            self.hidden = self.structured = False

    def handle_data(self, data: str) -> None:
        if self.structured:
            self.chunks.append(data)
        elif not self.hidden:
            self.text.append(data.strip())


class Event(BaseModel):
    kind: str = Field(alias="@type")
    start: datetime | None = Field(default=None, alias="startDate")


class Graph(BaseModel):
    events: list[Event] = Field(default_factory=lambda: list[Event](), alias="@graph")


def parse_sls(text: str, mission: str) -> Launch:
    provider, name, url = MISSIONS[mission]
    page = Page()
    page.feed(text)
    visible = " ".join(page.text)
    match = re.search(r"Projected To Launch\s+(.+?)(?:Watch In Person|Trajectory)", visible)
    if match is None:
        raise ValueError("Launch date label missing")
    label = " ".join(match[1].split())
    # JSON-LD can turn month precision into a fictitious last-day midnight.
    has_day = has_calendar_day(label)
    day: date | None = None
    for script in page.scripts:
        try:
            graph = Graph.model_validate_json(script)
        except ValueError:
            continue
        for event in graph.events:
            if event.kind == "Event" and event.start and has_day:
                day = event.start.astimezone(UTC).date()
    if has_day and day is None:
        raise ValueError("Day-level launch label without a valid event date")
    return Launch(
        id=mission,
        provider_id=provider,
        name=name,
        departure_date=day,
        label=label + " · NET/TBD",
        sources=[LaunchSource(name="Space Launch Schedule", url=url, label=label)],
    )


def merge_launches(records: list[Launch]) -> list[Launch]:
    merged: dict[str, Launch] = {}
    for item in records:
        previous = merged.get(item.id)
        if previous is None:
            merged[item.id] = item
            continue
        sources = previous.sources + item.sources
        days = {d for d in (previous.departure_date, item.departure_date) if d is not None}
        chosen = item if item.departure_date else previous
        merged[item.id] = chosen.model_copy(
            update={
                "sources": sources,
                "departure_date": next(iter(days)) if len(days) == 1 else None,
                "label": chosen.label if len(days) <= 1 else "출처별 날짜 불일치 · 직접 선택",
            }
        )
    return sorted(merged.values(), key=lambda item: (item.departure_date or date.max, item.name))
