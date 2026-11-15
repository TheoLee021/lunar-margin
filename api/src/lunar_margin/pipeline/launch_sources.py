"""Discover complete launch indexes and preserve optional lunar-only filtering."""

import calendar
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, date, datetime
from html import unescape
from urllib.parse import urlencode, urlsplit

from pydantic import BaseModel, Field, TypeAdapter

from lunar_margin.engine.launch_schedule import (
    LUNAR,
    SLS_URL,
    Launch,
    Page,
    mission_id,
    parse_sls,
    participants,
)

# Topic searches supplement the upcoming index with unlisted/TBD lunar program entries.
TOPICS = (
    "lunar",
    "moon",
    "artemis",
    "gateway",
    "griffin",
    "peregrine",
    "ispace",
    "apex",
    "ultra",
    "orion",
    "nova-c",
    "starship",
    "draper",
)
WP_URL = SLS_URL + "wp-json/wp/v2/launch-json"
FIELDS = "id,link,title,yoast_head_json.og_description,yoast_head_json.og_title,class_list"


@dataclass(frozen=True)
class Fetched:
    text: str
    pages: int = 1


@dataclass(frozen=True)
class Collected:
    launches: list[Launch]
    scanned_records: int
    scanned_pages: int


class Title(BaseModel):
    rendered: str


class Meta(BaseModel):
    og_description: str = ""
    og_title: str = ""


class Post(BaseModel):
    id: int
    link: str
    title: Title
    yoast_head_json: Meta = Field(default_factory=Meta)
    class_list: list[str] = Field(default_factory=lambda: list[str]())


POSTS = TypeAdapter(list[Post])


def launch_url(url: str) -> bool:
    parsed = urlsplit(url)
    return (
        parsed.scheme == "https"
        and parsed.netloc == "www.spacelaunchschedule.com"
        and parsed.path.startswith("/launch/")
        and not parsed.query
    )


def listing_ids(text: str) -> set[int]:
    return {int(value) for value in re.findall(r'<article\b[^>]*\bid=["\x27]post-(\d+)', text)}


def last_page(text: str) -> int:
    pages = [
        int(value)
        for value in re.findall(r"https://www\.spacelaunchschedule\.com/page/(\d+)/", text)
    ]
    last = max(pages, default=1)
    if last > 100:
        raise ValueError("Source pagination exceeds safety bound; collection is incomplete")
    return last


def collect_sls(
    fetch: Callable[[str], Fetched], today: date, *, all_launches: bool = False
) -> Collected:
    home = fetch(SLS_URL)
    count = last_page(home.text)
    with ThreadPoolExecutor(max_workers=4) as pool:
        pages = list(pool.map(fetch, [f"{SLS_URL}page/{n}/" for n in range(2, count + 1)]))
    article_html: dict[int, str] = {}
    for document in [home, *pages]:
        for article in re.findall(r"<article\b.*?</article>", document.text, re.S):
            for post_id in listing_ids(article):
                article_html[post_id] = article
    ids_set = listing_ids(home.text)
    for page in pages:
        ids_set.update(listing_ids(page.text))
    ids = sorted(ids_set)
    if not ids:
        raise ValueError("Upcoming launch index contains no records")
    queries = [dict(include=",".join(map(str, ids[i : i + 100]))) for i in range(0, len(ids), 100)]
    queries += [dict(search=topic) for topic in TOPICS]

    def collection(query: dict[str, str]) -> tuple[list[Post], int]:
        params = {**query, "per_page": "100", "_fields": FIELDS}
        first = fetch(WP_URL + "?" + urlencode(params))
        if first.pages > 100:
            raise ValueError("Search pagination exceeds safety bound; collection is incomplete")
        posts = POSTS.validate_json(first.text)
        for n in range(2, first.pages + 1):
            posts.extend(
                POSTS.validate_json(
                    fetch(WP_URL + "?" + urlencode({**params, "page": str(n)})).text
                )
            )
        return posts, first.pages

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(collection, queries))
    all_posts = {post.id: post for posts, _ in results for post in posts}
    if not set(ids).issubset(all_posts):
        raise ValueError("Source metadata omitted upcoming records; collection is incomplete")
    candidates: list[Post] = []
    for post in all_posts.values():
        description = unescape(post.yoast_head_json.og_description)
        name = unescape(post.title.rendered).split("|")[-1].strip()
        if launch_url(post.link) and (all_launches or LUNAR.search(name + " " + description)):
            if all_launches or participants(
                name, description, unescape(post.yoast_head_json.og_title)
            ):
                candidates.append(post)

    def detail(post: Post) -> Launch | None:
        html = article_html.get(post.id) if all_launches else None
        html = html or fetch(post.link).text
        page = Page()
        page.feed(html)
        visible = " ".join(page.text)
        if re.search(
            r"Launch Status\s+(?:Success|Failure|Launch Failure|Cancelled|Canceled)", visible, re.I
        ):
            return None
        # Historical pages omit the Projected marker. They are not upcoming entries.
        if "Projected To Launch" not in visible and re.search(
            r"Launch Status\s+Success", visible, re.I
        ):
            return None
        name = unescape(post.title.rendered).split("|")[-1].strip()
        agency = re.search(
            r'<h2[^>]*class=["\x27]entry-title["\x27][^>]*>\s*<span[^>]*>(.*?)</span>', html, re.S
        )
        launcher = (
            unescape(re.sub(r"<[^>]*>", "", agency[1])).strip()
            if agency
            else unescape(post.yoast_head_json.og_title)
        )
        row = parse_sls(
            html,
            f"sls-{post.id}" if all_launches else mission_id(name),
            name=name,
            description=unescape(post.yoast_head_json.og_description),
            launcher=launcher,
            url=post.link,
            all_launches=all_launches,
        )
        stamp = re.search(r'launch-time-utc=["\x27]([^"\x27]+)', html)
        date_value = (
            datetime.fromisoformat(stamp[1].replace("Z", "+00:00")).astimezone(UTC).date()
            if stamp
            else None
        )
        if date_value:
            end = date_value
            if row.date_precision == "year":
                end = date(date_value.year, 12, 31)
            elif row.date_precision == "quarter":
                last_month = ((date_value.month - 1) // 3 + 1) * 3
                end = date(
                    date_value.year,
                    last_month,
                    calendar.monthrange(date_value.year, last_month)[1],
                )
            elif row.date_precision == "month":
                end = date(
                    date_value.year,
                    date_value.month,
                    calendar.monthrange(date_value.year, date_value.month)[1],
                )
            if end < today:
                return None
        return row

    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(detail, candidates))
    return Collected(
        [row for row in rows if row is not None], len(all_posts), count + sum(n for _, n in results)
    )
