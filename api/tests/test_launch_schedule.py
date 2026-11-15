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
    assert body["launches"][0]["departure_date"] == "2027-01-06"
    assert not body["launches"][0]["confirmed"]


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
