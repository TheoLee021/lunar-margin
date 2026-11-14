import hashlib
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import httpx
import pytest

from lunar_margin.pipeline.fetch import ensure_file
from lunar_margin.pipeline.sources import Source

PAYLOAD = b"0123456789" * 1000


class _State:
    requests: int = 0
    truncate: bool = False


@pytest.fixture
def server() -> Iterator[tuple[str, type[_State]]]:
    class State(_State):
        requests = 0
        truncate = False

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            State.requests += 1
            self.send_response(200)
            self.send_header("Content-Length", str(len(PAYLOAD)))
            self.end_headers()
            self.wfile.write(PAYLOAD[: len(PAYLOAD) // 2] if State.truncate else PAYLOAD)
            self.wfile.flush()

        def log_message(self, format: str, *args: object) -> None:
            return

    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}", State
    httpd.shutdown()
    httpd.server_close()


def _source(base: str, size: int | None = len(PAYLOAD)) -> Source:
    return Source("fake", f"{base}/file.bin", "file.bin", size)


def test_downloads_missing_file_and_records_sha256(
    server: tuple[str, type[_State]], tmp_path: Path
) -> None:
    base, _ = server

    path = ensure_file(_source(base), tmp_path)

    assert path.read_bytes() == PAYLOAD
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["file.bin"]["sha256"] == hashlib.sha256(PAYLOAD).hexdigest()
    assert manifest["file.bin"]["size_bytes"] == len(PAYLOAD)


def test_skips_when_file_matches_manifest(server: tuple[str, type[_State]], tmp_path: Path) -> None:
    base, state = server
    ensure_file(_source(base), tmp_path)

    ensure_file(_source(base), tmp_path)

    assert state.requests == 1


def test_redownloads_when_size_mismatch(server: tuple[str, type[_State]], tmp_path: Path) -> None:
    base, state = server
    path = ensure_file(_source(base), tmp_path)
    path.write_bytes(PAYLOAD[:100])

    ensure_file(_source(base), tmp_path)

    assert path.read_bytes() == PAYLOAD
    assert state.requests == 2


def test_redownloads_when_content_differs_but_size_matches(
    server: tuple[str, type[_State]], tmp_path: Path
) -> None:
    base, state = server
    path = ensure_file(_source(base), tmp_path)
    path.write_bytes(b"x" * len(PAYLOAD))

    ensure_file(_source(base), tmp_path)

    assert path.read_bytes() == PAYLOAD
    assert state.requests == 2


def test_partial_download_never_visible_at_final_path(
    server: tuple[str, type[_State]], tmp_path: Path
) -> None:
    base, state = server
    state.truncate = True

    with pytest.raises(httpx.HTTPError):
        ensure_file(_source(base), tmp_path)

    assert not (tmp_path / "file.bin").exists()


# --- fetch_all: 두 DEM과 SPICE 커널을 한 번에 ---------------------------------------------


def _recorded_fetch(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    import lunar_margin.pipeline.fetch as fetch_module

    calls: list[tuple[str, str]] = []

    def fake(source: Source, dest_dir: Path, client: httpx.Client | None = None) -> Path:
        calls.append((source.filename, dest_dir.name))
        return dest_dir / source.filename

    monkeypatch.setattr(fetch_module, "ensure_file", fake)
    return calls


def test_fetch_all_downloads_both_dems_and_the_kernels_by_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from lunar_margin.pipeline.fetch import fetch_all

    calls = _recorded_fetch(monkeypatch)

    fetch_all(tmp_path)

    names = {name for name, _ in calls}
    assert {"ldem_80s_80m_float.img", "ldem_80s_80m_float.lbl"} <= names
    assert {"ldem_75s_120m_float.img", "ldem_75s_120m_float.lbl"} <= names
    assert {"de440s.bsp", "naif0012.tls"} <= names
    assert {folder for _, folder in calls} == {"dem", "spice"}


def test_fetch_all_can_skip_the_supplementary_dem(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from lunar_margin.pipeline.fetch import fetch_all

    calls = _recorded_fetch(monkeypatch)

    fetch_all(tmp_path, fallback_dem=None)

    assert not any("75s_120m" in name for name, _ in calls)


def test_fetch_all_rejects_unknown_dem_names(tmp_path: Path) -> None:
    from lunar_margin.pipeline.fetch import fetch_all

    with pytest.raises(ValueError, match="unknown DEM"):
        fetch_all(tmp_path, dem="nope")
    with pytest.raises(ValueError, match="unknown DEM"):
        fetch_all(tmp_path, fallback_dem="nope")
