"""큰 zip 안의 파일 하나만 HTTP Range 요청으로 받는다 (SfS 지역 DEM: 2 GB zip 속 21 MB)."""

import io
import json
import threading
import zipfile
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from lunar_margin.pipeline.fetch import ensure_zip_member
from lunar_margin.pipeline.sources import ZipMemberSource

WANTED = bytes(range(256)) * 400  # 102,400 B
FILLER = b"\x5a" * 3_000_000


def make_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("REGION/LROC/big_image.tif", FILLER, zipfile.ZIP_STORED)
        # macOS가 만든 zip에는 같은 이름의 리소스 포크 항목이 따로 있다
        archive.writestr("__MACOSX/REGION/._A306_GLDELEV_005.tif", b"not the raster")
        archive.writestr("REGION/A306_GLDELEV_005.tif", WANTED)
        archive.writestr("REGION/README.txt", b"hello", zipfile.ZIP_STORED)
    return buffer.getvalue()


class _State:
    served_bytes: int = 0
    requests: int = 0
    honour_range: bool = True


@pytest.fixture
def server() -> Iterator[tuple[str, type[_State]]]:
    payload = make_zip()

    class State(_State):
        served_bytes = 0
        requests = 0
        honour_range = True

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            State.requests += 1
            spec = self.headers.get("Range")
            if spec is None or not State.honour_range:
                self.send_response(200)
                body = payload
            else:
                first, last = spec.removeprefix("bytes=").split("-")
                if first == "":  # 끝에서부터 N바이트
                    start, end = max(len(payload) - int(last), 0), len(payload) - 1
                else:
                    start, end = int(first), min(int(last), len(payload) - 1)
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(payload)}")
                body = payload[start : end + 1]
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            State.served_bytes += len(body)

        def log_message(self, format: str, *args: object) -> None:
            return

    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}", State
    httpd.shutdown()
    httpd.server_close()


def source(base: str, suffix: str = "_GLDELEV_005.tif") -> ZipMemberSource:
    return ZipMemberSource("fake region", f"{base}/region.zip", suffix, "region_elev.tif")


def test_extracts_one_member_without_downloading_the_whole_zip(
    server: tuple[str, type[_State]], tmp_path: Path
) -> None:
    base, state = server

    path = ensure_zip_member(source(base), tmp_path)

    assert path == tmp_path / "region_elev.tif"
    assert path.read_bytes() == WANTED
    assert state.served_bytes < 200_000  # zip은 3 MB가 넘는다
    entry = json.loads((tmp_path / "manifest.json").read_text())["region_elev.tif"]
    assert entry["size_bytes"] == len(WANTED) and entry["url"].endswith("/region.zip")


def test_a_file_that_matches_the_manifest_is_not_fetched_again(
    server: tuple[str, type[_State]], tmp_path: Path
) -> None:
    base, state = server
    ensure_zip_member(source(base), tmp_path)
    before = state.requests

    ensure_zip_member(source(base), tmp_path)

    assert state.requests == before


def test_a_member_that_is_not_in_the_zip_is_an_error(
    server: tuple[str, type[_State]], tmp_path: Path
) -> None:
    base, _ = server

    with pytest.raises(ValueError, match=r"_GLDOMOS_005\.tif"):
        ensure_zip_member(source(base, "_GLDOMOS_005.tif"), tmp_path)
    assert not (tmp_path / "region_elev.tif").exists()


def test_a_server_that_ignores_range_requests_is_an_error_not_a_full_download(
    server: tuple[str, type[_State]], tmp_path: Path
) -> None:
    base, state = server
    state.honour_range = False

    with pytest.raises(ValueError, match="ignored the Range request"):
        ensure_zip_member(source(base), tmp_path)
