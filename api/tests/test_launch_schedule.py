import json
from datetime import date

import pytest

from lunar_margin.engine.launch_schedule import merge_launches, parse_sfn, parse_sls


def test_month_placeholder_is_not_a_selectable_departure_and_two_sources_merge() -> None:
    sfn = parse_sfn(
        json.dumps(
            {
                "launches": [
                    {
                        "mission_name": "Griffin Mission 1",
                        "launch_date_label": "NET January 2027",
                        "launch_date_iso": "2027-01-01T00:00:00Z",
                        "net_month_only": True,
                        "net_date_only": True,
                        "date_tbd": False,
                    }
                ]
            }
        )
    )
    assert sfn[0].departure_date is None
    html = """<p>Launch Status</p><p>Date/Time TBD</p><p>Projected To Launch</p>
    <p>Wed • Jan 6th, 2027</p><p>Watch In Person</p>
    <script type="application/ld+json">
    {"@graph":[{"@type":"Event","startDate":"2027-01-06T00:00:00Z"}]}</script>"""
    sls = parse_sls(html, "griffin-1")
    merged = merge_launches([*sfn, sls])
    assert len(merged) == 1
    assert str(merged[0].departure_date) == "2027-01-06"
    assert not merged[0].confirmed
    assert len(merged[0].sources) == 2
    assert merged[0].provider_id == "voyager"  # Falcon Heavy is the launcher, not the seller.
    month = html.replace("Wed • Jan 6th, 2027", "January, 2027").replace("2027-01-06", "2027-01-31")
    assert parse_sls(month, "griffin-1").departure_date is None


def test_schedule_endpoint_keeps_dated_snapshot_when_sources_are_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi.testclient import TestClient

    from lunar_margin.app.launch_schedule import get_reader
    from lunar_margin.app.main import create_app
    from lunar_margin.app.settings import Settings

    def offline(*args: object, **kwargs: object) -> None:
        raise OSError("offline")

    monkeypatch.setattr("lunar_margin.app.launch_schedule.urlopen", offline)
    get_reader.cache_clear()
    response = TestClient(create_app(Settings())).get("/pricing/providers/launches")
    get_reader.cache_clear()
    assert response.status_code == 200
    body = response.json()
    assert body["timezone"] == "UTC"
    assert all(source["stale"] and source["error"] for source in body["sources"])
    # All-launch demo scope adds earlier flights; the saved lunar record must still survive.
    griffin = next(row for row in body["launches"] if "Griffin Mission" in row["name"])
    assert griffin["departure_date"] == "2027-01-06"
    assert not griffin["confirmed"]


def test_concurrent_schedule_read_returns_dated_stale_snapshot_during_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from lunar_margin.app.launch_schedule import ScheduleReader

    started = Event()
    release = Event()

    def delayed_offline(*args: object, **kwargs: object) -> None:
        started.set()
        if not release.wait(timeout=5):
            raise OSError("test source timed out")
        raise OSError("offline")

    monkeypatch.setattr("lunar_margin.app.launch_schedule.urlopen", delayed_offline)
    reader = ScheduleReader()
    previous = reader.peek()
    with ThreadPoolExecutor(max_workers=2) as pool:
        refresh = pool.submit(reader.read)
        try:
            assert started.wait(timeout=2)
            snapshot = pool.submit(reader.read).result(timeout=1)
            assert snapshot.launches == previous.launches
            assert [source.fetched_at for source in snapshot.sources] == [
                source.fetched_at for source in previous.sources
            ]
            assert all(source.stale for source in snapshot.sources)
        finally:
            release.set()
        refresh.result(timeout=2)


def test_conflicting_day_sources_do_not_select_a_departure() -> None:
    from lunar_margin.engine.launch_schedule import Launch, LaunchSource

    first = Launch(
        id="griffin-1",
        provider_id="voyager",
        name="Griffin",
        departure_date=date(2027, 1, 6),
        label="January 6",
        sources=[
            LaunchSource(
                name="Spaceflight Now",
                url="https://spaceflightnow.com/launch-schedule/",
                label="January 6",
            )
        ],
    )
    other = first.model_copy(update={"departure_date": date(2027, 1, 7)})
    result = merge_launches([first, other])
    assert result[0].departure_date is None
    assert "불일치" in result[0].label


def test_all_company_missions_are_discovered_without_a_two_mission_allowlist() -> None:
    from lunar_margin.engine.launch_schedule import parse_sfn

    feed = {
        "launches": [
            {
                "mission_name": "Griffin Mission 2",
                "provider": "SpaceX",
                "description": "Voyager lunar cargo lander",
                "launch_date_label": "2028",
            },
            {
                "mission_name": "Blue Moon MK1 VIPER",
                "provider": "Blue Origin",
                "description": "Lunar South Pole",
                "launch_date_label": "NET 2027",
            },
            {
                "mission_name": "APEX 1.0",
                "provider": "ULA",
                "description": "ispace-U.S. lunar delivery",
                "launch_date_label": "2029",
            },
            {
                "mission_name": "Starship Lunar Cargo 2",
                "provider": "SpaceX",
                "description": "Moon cargo",
                "launch_date_label": "2028",
            },
            {
                "mission_name": "Orion science demo",
                "provider": "NASA",
                "description": "Lockheed Martin lunar exploration mission",
                "launch_date_label": "TBD",
            },
            {
                "mission_name": "Lunar Infrastructure Demo",
                "provider": "Northrop Grumman",
                "description": "Moon surface power",
                "launch_date_label": "2030",
            },
            {
                "mission_name": "Starlink 99",
                "provider": "SpaceX",
                "description": "Broadband satellites in low Earth orbit",
                "launch_date_label": "2027",
            },
        ]
    }
    rows = parse_sfn(json.dumps(feed))
    assert len(rows) == 6
    assert {row.provider_id for row in rows} == {
        "blue_origin",
        "ispace_us",
        "spacex",
        "lockheed_martin",
        "northrop_grumman",
        "voyager",
    }
    assert all(row.departure_date is None for row in rows)
    assert (
        next(row for row in rows if "Griffin" in row.name).participants[1].provider_id == "spacex"
    )


def test_sls_year_precision_does_not_become_a_december_launch_date() -> None:
    html = """<p>Launch Status Date/Time TBD</p>
    <p>Projected To Launch December, 2029 Watch In Person</p>
    <time class="launchDateTime" launch-time-utc="2029-12-31T00:00:00Z" data-precision="14"></time>
    <script type="application/ld+json">
    {"@graph":[{"@type":"Event","startDate":"2029-12-31T00:00:00Z"}]}</script>"""
    row = parse_sls(
        html,
        "new-lunar-mission",
        name="New Lunar Mission",
        description="Northrop Grumman Moon surface infrastructure",
    )
    assert row.provider_id == "northrop_grumman"
    assert row.date_precision == "year"
    assert row.departure_date is None
    assert row.label.startswith("2029년")
    assert "December" not in row.label
    tbd = parse_sls("<p>Launch Status Date/Time TBD</p>", "future-griffin", name="Griffin 12")
    assert tbd.departure_date is None
    assert tbd.date_precision == "unknown"


def test_contextual_history_does_not_assign_viper_delivery_to_voyager() -> None:
    from lunar_margin.engine.launch_schedule import participants

    roles = participants(
        "Blue Moon VIPER",
        "NASA cancelled its Astrobotic VIPER delivery. Blue Origin will deliver the rover.",
        "Blue Origin",
    )
    assert [row.provider_id for row in roles] == ["blue_origin"]
    assert roles[0].role == "delivery"


def test_collection_reads_all_upcoming_pages_and_all_search_pages() -> None:
    from urllib.parse import parse_qs, urlsplit

    from lunar_margin.pipeline.launch_sources import Fetched, collect_sls

    def post(index: int, name: str, company: str) -> dict[str, object]:
        return {
            "id": index,
            "link": f"https://www.spacelaunchschedule.com/launch/mission-{index}/",
            "title": {"rendered": f"Rocket | {name}"},
            "yoast_head_json": {
                "og_description": f"{company} lunar exploration",
                "og_title": f"{company} {name}",
            },
        }

    rows = [
        post(1, "Griffin 8", "SpaceX"),
        post(2, "APEX Future", "ispace-U.S."),
        post(3, "Lunar Science 9", "Lockheed Martin"),
        post(4, "Lunar Power 7", "Northrop Grumman"),
    ]
    html = """<p>Projected To Launch December, 2030 Watch In Person</p>
    <time class="launchDateTime" launch-time-utc="2030-12-31T00:00:00Z" data-precision="14"></time>
    """

    def fetch(url: str) -> Fetched:
        parsed = urlsplit(url)
        if parsed.path == "/":
            return Fetched(
                '<article id="post-1"></article><a href="https://www.spacelaunchschedule.com/page/2/">2</a>'
            )
        if parsed.path == "/page/2/":
            return Fetched('<article id="post-2"></article>')
        if parsed.path.startswith("/launch/"):
            return Fetched(html)
        query = parse_qs(parsed.query)
        if "include" in query:
            return Fetched(json.dumps(rows[:2]))
        if query.get("search") == ["lunar"]:
            return Fetched(
                json.dumps([rows[3] if query.get("page") == ["2"] else rows[2]]), pages=2
            )
        return Fetched("[]")

    result = collect_sls(fetch, date(2026, 11, 15))
    assert {row.name for row in result.launches} == {
        "Griffin 8",
        "APEX Future",
        "Lunar Science 9",
        "Lunar Power 7",
    }
    assert result.scanned_records == 4
    assert all(
        row.date_precision == "year" and row.departure_date is None for row in result.launches
    )


def test_demo_scope_includes_non_lunar_launches_and_ula() -> None:
    rows = parse_sfn(
        json.dumps(
            {
                "launches": [
                    {
                        "id": "amazon",
                        "mission_name": "Amazon Leo (LV-01)",
                        "provider": "United Launch Alliance (ULA)",
                        "description": "Internet satellites in low Earth orbit",
                        "launch_date_label": "November 15",
                        "launch_date_iso": "2026-11-15T17:11:30Z",
                    },
                    {
                        "id": "ussf",
                        "mission_name": "USSF-317",
                        "provider": "SpaceX",
                        "description": "Military LEO mission",
                        "launch_date_label": "November 18",
                        "launch_date_iso": "2026-11-18T03:14:00Z",
                    },
                ]
            }
        ),
        all_launches=True,
    )
    assert [row.name for row in rows] == ["Amazon Leo (LV-01)", "USSF-317"]
    assert rows[0].provider_id is None
    assert rows[0].launch_provider == "United Launch Alliance (ULA)"
    assert str(rows[1].departure_date) == "2026-11-18"
    assert not any(row.lunar_related for row in rows)
    # Unnamed payloads can be separate flights from the same operator.
    first = rows[1].model_copy(
        update={"id": "sfn-a", "name": "Unknown Payload", "departure_date": None}
    )
    second = first.model_copy(update={"id": "sfn-b"})
    assert len(merge_launches([first, second])) == 2
