import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import lunar_margin.pipeline.table_prefetch as prefetch
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.pipeline.table_storage import StorageConfig


@pytest.fixture(autouse=True)
def _isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """개발자의 실제 .env나 셸 환경변수를 읽지 않는다 (읽으면 테스트가 흔들린다)."""
    monkeypatch.chdir(tmp_path)  # Settings는 현재 폴더의 .env를 읽는다
    for name in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_BUCKET",
        "HORIZON_TABLE_DOWNLOAD_ON_START",
    ):
        monkeypatch.delenv(name, raising=False)


def settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "supabase_url": "https://x.supabase.co",
        "supabase_service_role_key": "k",
        "data_dir": Path("/nonexistent-data"),
    }
    return Settings(**{**base, **overrides})  # pyright: ignore[reportArgumentType]


class Spy:
    def __init__(self) -> None:
        self.downloads: list[StorageConfig] = []
        self.delay = 0.0
        self.error: Exception | None = None

    def download(
        self, config: object, data_dir: Path, storage: StorageConfig, **kw: object
    ) -> Path:
        time.sleep(self.delay)
        if self.error is not None:
            raise self.error
        self.downloads.append(storage)
        return data_dir / "horizons" / "x"


@pytest.fixture
def spy(monkeypatch: pytest.MonkeyPatch) -> Spy:
    spy = Spy()
    monkeypatch.setattr(prefetch, "download_for_config", spy.download)

    def fake_spec(config: object, data_dir: Path) -> str:
        return "spec"

    def no_table(root: Path, spec: object) -> None:
        return None  # 테이블이 아직 없다

    monkeypatch.setattr(prefetch, "table_spec_for", fake_spec)
    monkeypatch.setattr(prefetch, "find_table", no_table)
    return spy


def run(cfg: Settings) -> threading.Thread | None:
    messages: list[str] = []
    thread = prefetch.start_prefetch(cfg, log=messages.append)
    if thread is not None:
        thread.join(timeout=5)
    return thread


def test_a_missing_table_is_downloaded_in_the_background(spy: Spy) -> None:
    thread = run(settings())

    assert thread is not None and thread.daemon  # 서버 종료를 막지 않는다
    assert len(spy.downloads) == 1
    assert (
        spy.downloads[0].url == "https://x.supabase.co"
        and spy.downloads[0].bucket == "horizon-tables"
    )


def test_nothing_happens_without_storage_credentials(spy: Spy) -> None:
    assert run(settings(supabase_url=None)) is None
    assert run(settings(supabase_service_role_key=None)) is None
    assert spy.downloads == []


def test_it_can_be_switched_off(spy: Spy) -> None:
    assert run(settings(horizon_table_download_on_start=False)) is None
    assert spy.downloads == []


def test_an_existing_table_is_left_alone(spy: Spy, monkeypatch: pytest.MonkeyPatch) -> None:
    def has_table(root: Path, spec: object) -> object:
        return object()

    monkeypatch.setattr(prefetch, "find_table", has_table)

    assert run(settings()) is None
    assert spy.downloads == []


def test_missing_dem_files_skip_the_download_and_say_why(
    spy: Spy, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_dem(config: object, data_dir: Path) -> object:
        raise FileNotFoundError(
            "DEM files not found; run `uv run python -m lunar_margin.pipeline.fetch`"
        )

    monkeypatch.setattr(prefetch, "table_spec_for", no_dem)
    messages: list[str] = []

    thread = prefetch.start_prefetch(settings(), log=messages.append)

    assert thread is None and spy.downloads == []
    assert any("pipeline.fetch" in m for m in messages)


def test_a_failing_download_never_raises_and_is_reported(spy: Spy) -> None:
    spy.error = RuntimeError("storage is down")
    messages: list[str] = []

    thread = prefetch.start_prefetch(settings(), log=messages.append)
    assert thread is not None
    thread.join(timeout=5)

    assert not thread.is_alive()
    assert any("storage is down" in m for m in messages)


def test_the_server_starts_and_answers_while_the_download_is_still_running(
    spy: Spy, monkeypatch: pytest.MonkeyPatch
) -> None:
    spy.delay = 0.6
    app = create_app(settings())

    started = time.monotonic()
    with TestClient(app) as client:
        response = client.get("/health")
        elapsed = time.monotonic() - started

    assert response.status_code == 200 and elapsed < 0.5  # 다운로드(0.6초)를 기다리지 않는다


def test_startup_triggers_exactly_one_prefetch(monkeypatch: pytest.MonkeyPatch) -> None:
    import lunar_margin.app.main as main_module

    calls: list[Settings] = []

    def record(s: Settings, **kw: object) -> None:
        calls.append(s)

    monkeypatch.setattr(main_module, "start_prefetch", record)

    with TestClient(create_app(settings())):
        pass

    assert len(calls) == 1
