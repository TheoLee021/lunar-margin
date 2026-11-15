"""수평선 테이블을 Supabase Storage에 올리고 받는다 (새 라이브러리 없이 httpx 사용).

- 파일은 part_size(기본 32 MiB)씩 나눠 올린다. 플랜별 파일 크기 한도에 걸리지 않게 한다.
- 전체 파일의 sha256을 적은 manifest.json을 **마지막에** 올린다 (있으면 완전히 올라간 것).
- 받을 때는 임시 폴더에 조립하고 sha256을 검증한 뒤에만 제자리로 옮긴다.
  실패하면 아무것도 남기지 않는다.
- 올리기에는 service_role 키가 필요하므로 백엔드나 로컬 스크립트에서만 쓴다 (프론트에 두지 않는다).
  버킷은 비공개로 만든다.
"""

import hashlib
import re
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Self

import httpx
from pydantic import BaseModel

from lunar_margin.app.settings import Settings

DEFAULT_PART_SIZE = 32 * 1024 * 1024
_TABLE_ID = re.compile(r"[0-9a-f]{12}")
_PREFIX = "horizons"


class FileInfo(BaseModel):
    size: int
    sha256: str
    parts: int


class Manifest(BaseModel):
    table_id: str
    part_size: int
    files: dict[str, FileInfo]


class StorageError(RuntimeError):
    pass


class StorageNotConfigured(StorageError):
    pass


@dataclass(frozen=True)
class StorageConfig:
    url: str
    key: str
    bucket: str

    @classmethod
    def from_settings(cls, settings: Settings) -> Self:
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise StorageNotConfigured(
                "Supabase Storage is not configured: set SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY (and optionally SUPABASE_BUCKET) in api/.env"
            )
        return cls(
            url=settings.supabase_url.rstrip("/"),
            key=settings.supabase_service_role_key,
            bucket=settings.supabase_bucket,
        )

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.key}", "apikey": self.key}


def _check_id(table_id: str) -> None:
    if _TABLE_ID.fullmatch(table_id) is None:
        raise ValueError(f"invalid table id {table_id!r}: expected 12 lowercase hex characters")


def _object(table_id: str, name: str) -> str:
    return f"{_PREFIX}/{table_id}/{name}"


def _raise_for(response: httpx.Response, what: str) -> None:
    if response.status_code >= 400:
        raise StorageError(f"{what} failed with HTTP {response.status_code}: {response.text[:200]}")


def _upload(client: httpx.Client, cfg: StorageConfig, path: str, data: bytes) -> None:
    response = client.post(
        f"{cfg.url}/storage/v1/object/{cfg.bucket}/{path}",
        content=data,
        headers={
            **cfg.headers(),
            "x-upsert": "true",  # 다시 올려도 오류가 나지 않는다
            "Content-Type": "application/octet-stream",
        },
    )
    _raise_for(response, f"upload of {path}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def upload_table(
    directory: Path,
    cfg: StorageConfig,
    *,
    part_size: int = DEFAULT_PART_SIZE,
    client: httpx.Client | None = None,
    log: Callable[[str], None] = print,
) -> str:
    """테이블 폴더(이름이 table id)를 조각으로 나눠 올리고 id를 돌려준다."""
    table_id = directory.name
    _check_id(table_id)
    if not (directory / "meta.json").exists():
        raise StorageError(f"{directory} is not a finished horizon table (meta.json is missing)")
    owns = client is None
    http = client or httpx.Client(timeout=httpx.Timeout(300.0))
    try:
        files: dict[str, FileInfo] = {}
        for path in sorted(p for p in directory.iterdir() if p.is_file()):
            size = path.stat().st_size
            parts = max(1, -(-size // part_size))
            log(f"올리는 중: {path.name} ({size / 1e6:.1f} MB, 조각 {parts}개)")
            with path.open("rb") as handle:
                for index in range(parts):
                    _upload(
                        http,
                        cfg,
                        _object(table_id, f"{path.name}.part{index:04d}"),
                        handle.read(part_size),
                    )
            files[path.name] = FileInfo(size=size, sha256=_sha256(path), parts=parts)
        manifest = Manifest(table_id=table_id, part_size=part_size, files=files)
        # manifest를 마지막에 올린다: 이게 보이면 모든 조각이 올라가 있다
        _upload(http, cfg, _object(table_id, "manifest.json"), manifest.model_dump_json().encode())
    finally:
        if owns:
            http.close()
    log(f"완료: 테이블 {table_id}")
    return table_id


def _verify_existing(target: Path, manifest: Manifest) -> bool:
    for name, info in manifest.files.items():
        path = target / name
        if not path.exists() or _sha256(path) != info.sha256:
            return False
    return True


def download_table(
    table_id: str,
    dest_root: Path,
    cfg: StorageConfig,
    *,
    client: httpx.Client | None = None,
    log: Callable[[str], None] = print,
) -> Path:
    """dest_root/{table_id}/에 테이블을 내려받는다. sha256이 맞아야 제자리에 놓는다."""
    _check_id(table_id)
    owns = client is None
    http = client or httpx.Client(timeout=httpx.Timeout(300.0))
    try:

        def get(name: str) -> httpx.Response:
            response = http.get(
                f"{cfg.url}/storage/v1/object/authenticated/{cfg.bucket}/{_object(table_id, name)}",
                headers=cfg.headers(),
            )
            if response.status_code == 404:
                raise StorageError(f"{name} of table {table_id} was not found in the bucket")
            _raise_for(response, f"download of {name}")
            return response

        try:
            manifest = Manifest.model_validate_json(get("manifest.json").content)
        except StorageError as error:
            raise StorageError(f"table {table_id}: manifest is missing ({error})") from error
        target = dest_root / table_id
        if target.is_dir() and _verify_existing(target, manifest):
            log(f"이미 있습니다 (sha256 확인됨): {target}")
            return target

        dest_root.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=f".{table_id}-", dir=dest_root))
        try:
            for name, info in manifest.files.items():
                log(f"받는 중: {name} ({info.size / 1e6:.1f} MB, 조각 {info.parts}개)")
                with (staging / name).open("wb") as out:
                    for index in range(info.parts):
                        out.write(get(f"{name}.part{index:04d}").content)
                if _sha256(staging / name) != info.sha256:
                    raise StorageError(f"{name}: sha256 does not match the manifest (corrupted)")
            if target.exists():
                shutil.rmtree(target)
            staging.rename(target)  # meta.json까지 모두 검증된 뒤에 한 번에 제자리로
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise
    finally:
        if owns:
            http.close()
    log(f"완료: {target}")
    return target
