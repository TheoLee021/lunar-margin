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
PROVIDERS: dict[ProviderId, str] = {
    "blue_origin": "Blue Origin",
    "ispace_us": "ispace-U.S.",
    "spacex": "SpaceX",
    "lockheed_martin": "Lockheed Martin Space",
    "northrop_grumman": "Northrop Grumman Space Systems",
    "voyager": "Voyager Technologies",
}
ALIASES: dict[ProviderId, str] = {
    "blue_origin": r"blue origin|blue moon",
    "ispace_us": r"ispace[ -](?:u\.?s\.?|united states)|apex|team draper",
    "spacex": r"spacex|starship",
    "lockheed_martin": r"lockheed martin",
    "northrop_grumman": r"northrop grumman|orbital atk",
    "voyager": r"voyager|astrobotic|griffin|peregrine",
}
LUNAR = re.compile(
    r"\blunar\b|\bmoon\b|\bartemis\s+(?:[ivx]+|[2-9])\b|\bgriffin\b|\bperegrine\b|"
    r"\bblue ghost\b|\bnova-c\b|\bapex\b|\b(?:ppe|halo)\b.*\bgateway\b",
    re.I,
)


class Participation(Model):
    provider_id: ProviderId
    role: Literal["delivery", "launch", "partner"]


def participants(name: str, description: str, launcher: str) -> list[Participation]:
    result: list[Participation] = []
    # Identify the vehicle in this mission's name before reading contextual mentions.
    for key in ("voyager", "blue_origin", "ispace_us"):
        if re.search(ALIASES[key], name, re.I):
            result.append(Participation.model_validate({"provider_id": key, "role": "delivery"}))
    for key, pattern in ALIASES.items():
        if any(row.provider_id == key for row in result):
            continue
        if re.search(pattern, launcher, re.I):
            result.append(Participation(provider_id=key, role="launch"))
    for key, pattern in ALIASES.items():
        if any(row.provider_id == key for row in result):
            continue
        sentences = re.split(r"(?<=[.!?])\s+|\n", description)
        current_mentions = [
            line
            for line in sentences
            if re.search(pattern, line, re.I)
            and not re.search(r"cancel(?:led|ed)|originally|previously|formerly", line, re.I)
        ]
        if current_mentions or re.search(pattern, name, re.I):
            result.append(Participation(provider_id=key, role="partner"))
    return result


def mission_id(name: str) -> str:
    normalized = name.lower().strip()
    for word, number in (("one", "1"), ("two", "2"), ("three", "3"), ("four", "4")):
        normalized = re.sub(rf"\b{word}\b", number, normalized)
    normalized = re.sub(r"\bmission\s+(?=\d)", "", normalized)
    normalized = re.sub(r"\([^)]*\)", "", normalized)
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def precision(label: str) -> Literal["day", "month", "year", "quarter", "unknown"]:
    if has_calendar_day(label):
        return "day"
    if re.search(r"\bQ[1-4]\b|quarter", label, re.I):
        return "quarter"
    if re.search(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b", label):
        return "month"
    if re.search(r"\b20\d{2}\b", label):
        return "year"
    return "unknown"


class LaunchSource(Model):
    name: Literal["Spaceflight Now", "Space Launch Schedule"]
    url: str
    label: str


class Launch(Model):
    id: str
    provider_id: ProviderId | None
    name: str
    launch_provider: str = "발사사 미정"
    lunar_related: bool = True
    departure_date: date | None = None
    label: str
    confirmed: Literal[False] = False
    sources: list[LaunchSource]
    participants: list[Participation] = Field(default_factory=lambda: list[Participation]())
    date_precision: Literal["day", "month", "year", "quarter", "unknown"] = "unknown"


class FeedLaunch(BaseModel):
    id: str = ""
    mission_name: str
    provider: str = ""
    description: str = ""
    vehicle: str = ""
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


def parse_sfn(text: str, *, all_launches: bool = False) -> list[Launch]:
    records: list[Launch] = []
    for item in Feed.model_validate_json(text).launches:
        name = item.mission_name
        lunar = bool(LUNAR.search(f"{name} {item.description}"))
        if not all_launches and not lunar:
            continue
        roles = participants(name, item.description, item.provider)
        if not roles and not all_launches:
            continue
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
                id=f"sfn-{item.id}" if all_launches and item.id else mission_id(name),
                provider_id=roles[0].provider_id if roles else None,
                launch_provider=item.provider or "발사사 미정",
                lunar_related=lunar,
                name=name,
                participants=roles,
                date_precision=precision(item.launch_date_label),
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


def parse_sls(
    text: str,
    mission: str,
    *,
    name: str | None = None,
    description: str = "",
    launcher: str = "",
    url: str | None = None,
    all_launches: bool = False,
) -> Launch:
    name = name or mission.replace("-", " ").title()
    roles = participants(name, description, launcher)
    if not roles and not all_launches:
        raise ValueError("No listed company is associated with this lunar mission")
    provider = roles[0].provider_id if roles else None
    url = url or SLS_URL + "launch/" + mission + "/"
    page = Page()
    page.feed(text)
    visible = " ".join(page.text)
    match = re.search(r"Projected To Launch\s+(.+?)(?:Watch In Person|Trajectory)", visible)
    if match is not None:
        label = " ".join(match[1].split())
    else:
        tag = re.search(
            r'<time\b[^>]*class=["\x27]launchDateTime["\x27][^>]*>(.*?)</time>', text, re.S
        )
        if tag:
            clock = Page()
            clock.feed(tag[1])
            label = " ".join(" ".join(clock.text).replace("Projected To Launch", "").split())
        elif re.search(r"Date/Time TBD|To Be Determined", visible, re.I):
            label = "날짜 미정 (TBD)"
        else:
            raise ValueError("Launch date label missing")
    # JSON-LD can turn month precision into a fictitious last-day midnight.
    has_day = has_calendar_day(label)
    accuracy = re.search(r'data-precision=["\x27](\d+)', text)
    stamp = re.search(r'launch-time-utc=["\x27]([^"\x27]+)', text)
    resolved_precision = precision(label)
    if accuracy and stamp:
        code = int(accuracy[1])
        value = datetime.fromisoformat(stamp[1].replace("Z", "+00:00")).astimezone(UTC)
        if 0 <= code <= 5:
            has_day, resolved_precision = True, "day"
        elif code == 14:
            label, resolved_precision, has_day = f"{value.year}년 · 정확일 미정", "year", False
        elif code == 7:
            label, resolved_precision, has_day = (
                f"{value.year}-{value.month:02d} · 정확일 미정",
                "month",
                False,
            )
        elif code in (8, 9, 10, 11):
            label, resolved_precision, has_day = (
                f"{value.year}년 {code - 7}분기 · 정확일 미정",
                "quarter",
                False,
            )
        elif code in (12, 13):
            label, resolved_precision, has_day = (
                f"{value.year}년 {'상반기' if code == 12 else '하반기'} · 정확일 미정",
                "year",
                False,
            )
        elif code in (15, 16, 6):
            period = (
                f"FY {value.year}"
                if code == 15
                else f"{value.year // 10 * 10}년대"
                if code == 16
                else f"{value.year}년 주간 일정"
            )
            label, resolved_precision, has_day = f"{period} · 정확일 미정", "unknown", False
    day: date | None = (
        datetime.fromisoformat(stamp[1].replace("Z", "+00:00")).astimezone(UTC).date()
        if has_day and accuracy and stamp
        else None
    )
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
        launch_provider=launcher or "발사사 미정",
        lunar_related=bool(LUNAR.search(name + " " + description)),
        name=name,
        departure_date=day,
        participants=roles,
        date_precision=resolved_precision,
        label=label + " · NET/TBD",
        sources=[LaunchSource(name="Space Launch Schedule", url=url, label=label)],
    )


def merge_launches(records: list[Launch]) -> list[Launch]:
    def combine(rows: list[Launch]) -> Launch:
        chosen = next((row for row in rows if row.departure_date), rows[0])
        days = {row.departure_date for row in rows if row.departure_date is not None}
        sources = {
            (source.name, source.url, source.label): source
            for row in rows
            for source in row.sources
        }
        roles = {(p.provider_id, p.role): p for row in rows for p in row.participants}
        return chosen.model_copy(
            update={
                "sources": list(sources.values()),
                "participants": list(roles.values()),
                "lunar_related": any(row.lunar_related for row in rows),
                "departure_date": next(iter(days)) if len(days) == 1 else None,
                "label": chosen.label if len(days) <= 1 else "출처별 날짜 불일치 · 직접 선택",
            }
        )

    exact: dict[str, list[Launch]] = {}
    for row in records:
        exact.setdefault(row.id, []).append(row)
    groups: dict[str, list[Launch]] = {}
    for rows in exact.values():
        row = combine(rows)
        # Vendor names can include different legal suffixes, so use the matched target company
        # for known launch operators; other operators retain their own literal identity.
        launch_roles = [p.provider_id for p in row.participants if p.role == "launch"]
        abbreviation = re.search(r"\(([A-Za-z0-9.-]{2,10})\)$", row.launch_provider)
        operator = (
            launch_roles[0]
            if launch_roles
            else re.sub(
                r"[^a-z0-9]+",
                "",
                (abbreviation[1] if abbreviation else row.launch_provider).lower(),
            )
        )
        key = mission_id(row.name) + ":" + operator
        groups.setdefault(key, []).append(row)
    result: list[Launch] = []
    for rows in groups.values():
        counts: dict[str, int] = {}
        for row in rows:
            for source in {s.name for s in row.sources}:
                counts[source] = counts.get(source, 0) + 1
        if max(counts.values(), default=0) <= 1:
            result.append(combine(rows))
        else:
            # Repeated generic mission names are separate flights, even with unknown dates.
            result.extend(rows)
    return sorted(result, key=lambda row: (row.departure_date or date.max, row.name, row.id))
