from fastapi.testclient import TestClient

from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings

PROD = "https://lunar-margin.vercel.app"
PREVIEW_REGEX = r"https://lunar-margin-[a-z0-9-]+-theolee021s-projects\.vercel\.app"


def allowed_origin(settings: Settings, origin: str) -> str | None:
    client = TestClient(create_app(settings))
    response = client.get("/health", headers={"Origin": origin})
    return response.headers.get("access-control-allow-origin")


def test_allows_listed_origin() -> None:
    settings = Settings(cors_origins=PROD)

    assert allowed_origin(settings, PROD) == PROD


def test_allows_preview_origin_matching_regex() -> None:
    settings = Settings(cors_origins=PROD, cors_origin_regex=PREVIEW_REGEX)
    preview = "https://lunar-margin-git-feat-x-theolee021s-projects.vercel.app"

    assert allowed_origin(settings, preview) == preview


def test_rejects_origin_outside_list_and_regex() -> None:
    settings = Settings(cors_origins=PROD, cors_origin_regex=PREVIEW_REGEX)

    assert allowed_origin(settings, "https://lunar-margin-x-someone-else.vercel.app") is None
    assert allowed_origin(settings, "https://evil.example.com") is None


def test_regex_is_optional() -> None:
    settings = Settings(cors_origins=PROD)
    preview = "https://lunar-margin-git-feat-x-theolee021s-projects.vercel.app"

    assert allowed_origin(settings, preview) is None
