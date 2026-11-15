import hashlib
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np
import pytest

from lunar_margin.pipeline.table_storage import (
    StorageConfig,
    StorageError,
    StorageNotConfigured,
    download_table,
    upload_table,
)


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


TABLE_ID = "0123456789ab"
KEY = "service-role-secret"


class FakeSupabase:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.requests: list[tuple[str, str, dict[str, str]]] = []
        self.corrupt: set[str] = set()  # 이 경로를 내려받으면 내용이 바뀐다
        self.url = ""


@pytest.fixture
def supabase() -> Iterator[FakeSupabase]:
    fake = FakeSupabase()

    class Handler(BaseHTTPRequestHandler):
        def _auth_ok(self) -> bool:
            return (
                self.headers.get("Authorization") == f"Bearer {KEY}"
                and self.headers.get("apikey") == KEY
            )

        def do_POST(self) -> None:
            prefix = "/storage/v1/object/tables/"
            fake.requests.append(("POST", self.path, dict(self.headers)))
            # 인증이 틀려도 요청 본문을 먼저 끝까지 읽는다. 안 읽고 응답하면 클라이언트가 전송 중에
            # 연결이 끊겨 StorageError 대신 연결 오류가 나서 테스트가 가끔 실패한다
            body = self.rfile.read(int(self.headers["Content-Length"]))
            if not self._auth_ok() or not self.path.startswith(prefix):
                self.send_response(401)
                self.end_headers()
                return
            fake.objects[self.path.removeprefix(prefix)] = body
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"Key": "ok"}')

        def do_GET(self) -> None:
            prefix = "/storage/v1/object/authenticated/tables/"
            fake.requests.append(("GET", self.path, dict(self.headers)))
            if not self._auth_ok():
                self.send_response(401)
                self.end_headers()
                return
            name = self.path.removeprefix(prefix)
            data = fake.objects.get(name)
            if data is None:
                self.send_response(404)
                self.end_headers()
                return
            if name in fake.corrupt:
                data = bytes(b ^ 0xFF for b in data[:16]) + data[16:]
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: object) -> None:
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    fake.url = f"http://127.0.0.1:{server.server_port}"
    yield fake
    server.shutdown()
    server.server_close()


def config(fake: FakeSupabase) -> StorageConfig:
    return StorageConfig(url=fake.url, key=KEY, bucket="tables")


@pytest.fixture
def table(tmp_path: Path) -> Path:
    """실제 테이블과 같은 파일 구성을 가진 작은 테이블."""
    directory = tmp_path / "horizons" / TABLE_ID
    directory.mkdir(parents=True)
    rng = np.random.default_rng(0)
    np.save(directory / "elevation.npy", rng.integers(-500, 3000, (400, 360), dtype=np.int16))
    np.save(directory / "keys.npy", np.arange(400, dtype=np.int64))
    np.save(directory / "valid.npy", np.ones(400, dtype=np.bool_))
    np.save(directory / "complete.npy", np.ones(400, dtype=np.bool_))
    (directory / "meta.json").write_text(json.dumps({"version": 1, "sites": 400}) + "\n")
    return directory


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_upload_splits_large_files_and_writes_the_manifest_last(
    supabase: FakeSupabase, table: Path
) -> None:
    upload_table(table, config(supabase), part_size=100_000, log=lambda _: None)

    posts = [path for method, path, _ in supabase.requests if method == "POST"]
    assert posts[-1].endswith(f"horizons/{TABLE_ID}/manifest.json")  # 완전히 올라간 뒤에만 보인다
    parts = [p for p in supabase.objects if ".part" in p]
    assert all(len(supabase.objects[p]) <= 100_000 for p in parts)
    elevation_parts = [p for p in parts if "elevation.npy" in p]
    assert len(elevation_parts) == -(-(table / "elevation.npy").stat().st_size // 100_000) > 1
    manifest = json.loads(supabase.objects[f"horizons/{TABLE_ID}/manifest.json"])
    assert manifest["table_id"] == TABLE_ID and manifest["part_size"] == 100_000
    assert manifest["files"]["elevation.npy"]["sha256"] == sha(table / "elevation.npy")
    assert set(manifest["files"]) == {
        "elevation.npy", "keys.npy", "valid.npy", "complete.npy", "meta.json",
    }  # fmt: skip


def test_every_request_carries_the_service_role_key_and_uses_upsert(
    supabase: FakeSupabase, table: Path
) -> None:
    upload_table(table, config(supabase), part_size=100_000, log=lambda _: None)

    for method, _, headers in supabase.requests:
        assert headers["Authorization"] == f"Bearer {KEY}" and headers["apikey"] == KEY
        if method == "POST":
            assert headers["x-upsert"] == "true"  # 다시 올려도 오류가 나지 않는다


def test_download_reproduces_the_table_byte_for_byte(
    supabase: FakeSupabase, table: Path, tmp_path: Path
) -> None:
    upload_table(table, config(supabase), part_size=100_000, log=lambda _: None)
    target = tmp_path / "other-machine" / "horizons"

    result = download_table(TABLE_ID, target, config(supabase), log=lambda _: None)

    assert result == target / TABLE_ID
    for name in ("elevation.npy", "keys.npy", "valid.npy", "complete.npy", "meta.json"):
        assert sha(result / name) == sha(table / name), name
    assert [p.name for p in target.iterdir()] == [TABLE_ID]  # 임시 폴더가 남지 않는다


def test_downloaded_table_can_be_opened_by_the_engine(
    supabase: FakeSupabase, table: Path, tmp_path: Path
) -> None:
    upload_table(table, config(supabase), part_size=100_000, log=lambda _: None)
    result = download_table(TABLE_ID, tmp_path / "t", config(supabase), log=lambda _: None)

    assert np.load(result / "elevation.npy", mmap_mode="r").shape == (400, 360)


def test_an_existing_valid_table_is_not_downloaded_again(
    supabase: FakeSupabase, table: Path, tmp_path: Path
) -> None:
    upload_table(table, config(supabase), part_size=100_000, log=lambda _: None)
    target = tmp_path / "other-machine" / "horizons"  # 원본 테이블과 다른 위치
    download_table(TABLE_ID, target, config(supabase), log=lambda _: None)
    supabase.requests.clear()

    messages: list[str] = []
    download_table(TABLE_ID, target, config(supabase), log=messages.append)

    assert [m for m, p, _ in supabase.requests if "part" in p] == []  # 조각은 다시 받지 않는다
    assert any("이미 있" in m for m in messages)


def test_a_corrupted_download_is_rejected_and_leaves_nothing_behind(
    supabase: FakeSupabase, table: Path, tmp_path: Path
) -> None:
    upload_table(table, config(supabase), part_size=100_000, log=lambda _: None)
    supabase.corrupt.add(f"horizons/{TABLE_ID}/elevation.npy.part0000")
    target = tmp_path / "other-machine" / "horizons"  # 원본 테이블과 다른 위치

    with pytest.raises(StorageError, match="sha256"):
        download_table(TABLE_ID, target, config(supabase), log=lambda _: None)

    assert not (target / TABLE_ID).exists()
    assert list(target.iterdir()) == []  # 임시 폴더도 남지 않는다


def test_a_missing_manifest_is_a_clear_error(supabase: FakeSupabase, tmp_path: Path) -> None:
    with pytest.raises(StorageError, match="manifest"):
        download_table(TABLE_ID, tmp_path / "t", config(supabase), log=lambda _: None)


def test_wrong_key_is_reported_as_an_authorization_error(
    supabase: FakeSupabase, table: Path
) -> None:
    bad = StorageConfig(url=supabase.url, key="nope", bucket="tables")

    with pytest.raises(StorageError, match="401"):
        upload_table(table, bad, part_size=100_000, log=lambda _: None)


@pytest.mark.parametrize("bad", ["../x", "abc", "0123456789AB", "0123456789abc", ""])
def test_table_ids_are_validated_so_they_cannot_escape_the_target_folder(
    supabase: FakeSupabase, tmp_path: Path, bad: str
) -> None:
    with pytest.raises(ValueError, match="table id"):
        download_table(bad, tmp_path, config(supabase), log=lambda _: None)


def test_missing_credentials_name_the_environment_variables() -> None:
    from lunar_margin.app.settings import Settings

    with pytest.raises(StorageNotConfigured, match=r"SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY"):
        StorageConfig.from_settings(Settings(supabase_url=None, supabase_service_role_key=None))


def test_credentials_come_from_settings() -> None:
    from lunar_margin.app.settings import Settings

    settings = Settings(
        supabase_url="https://x.supabase.co/",
        supabase_service_role_key="k",
        supabase_bucket="b",
    )

    cfg = StorageConfig.from_settings(settings)

    assert (cfg.url, cfg.key, cfg.bucket) == ("https://x.supabase.co", "k", "b")


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("https://x.supabase.co", "https://x.supabase.co"),
        ("https://x.supabase.co/", "https://x.supabase.co"),
        # 대시보드에서 복사하기 쉬운 데이터베이스(REST) 주소나 Storage 주소도 받아 준다
        ("https://x.supabase.co/rest/v1/", "https://x.supabase.co"),
        ("https://x.supabase.co/rest/v1", "https://x.supabase.co"),
        ("https://x.supabase.co/storage/v1/", "https://x.supabase.co"),
        ("  https://x.supabase.co/rest/v1/  ", "https://x.supabase.co"),
    ],
)
def test_the_project_url_is_normalised_whatever_supabase_address_was_pasted(
    given: str, expected: str
) -> None:
    from lunar_margin.app.settings import Settings

    cfg = StorageConfig.from_settings(Settings(supabase_url=given, supabase_service_role_key="k"))

    assert cfg.url == expected
