import json
from datetime import date
from urllib.parse import parse_qs, urlsplit

import pytest

from lunar_margin.pipeline.launch_sources import Fetched, collect_sls


@pytest.mark.parametrize("quarter", [1, 2, 3, 4])
def test_quarter_schedule_survives_until_its_period_ends(quarter: int) -> None:
    month = 3 * quarter - 2
    stamp = f"2027-{month:02d}-01T00:00:00Z"
    html = (
        '<article id="post-1"><p>Projected To Launch 2027 Watch In Person</p>'
        f'<time launch-time-utc="{stamp}" data-precision="{quarter + 7}"></time>'
        "</article>"
    )
    post = {
        "id": 1,
        "link": "https://www.spacelaunchschedule.com/launch/quarterly-flight/",
        "title": {"rendered": "Rocket | Quarterly Flight"},
    }

    def fetch(url: str) -> Fetched:
        parsed = urlsplit(url)
        if parsed.path == "/":
            return Fetched(html)
        if "include" in parse_qs(parsed.query):
            return Fetched(json.dumps([post]))
        return Fetched("[]")

    active = collect_sls(fetch, date(2027, month + 1, 1), all_launches=True)
    assert len(active.launches) == 1
    assert active.launches[0].date_precision == "quarter"
    assert active.launches[0].departure_date is None
    next_quarter = date(2028, 1, 1) if quarter == 4 else date(2027, month + 3, 1)
    assert collect_sls(fetch, next_quarter, all_launches=True).launches == []
