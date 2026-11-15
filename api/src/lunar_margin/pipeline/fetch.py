"""NASA 원천 데이터를 DATA_DIR로 내려받고 크기·sha256을 manifest.json에 기록한다.

실행: uv run python -m lunar_margin.pipeline.fetch
"""

import argparse
import hashlib
import json
import struct
import zlib
from pathlib import Path

import httpx

from lunar_margin.app.settings import Settings
from lunar_margin.pipeline.sources import (
    DEM_SOURCES,
    SFS_SOURCES,
    SPICE_SOURCES,
    WIDE_DEM,
    Source,
    ZipMemberSource,
)

MANIFEST_NAME = "manifest.json"
_CHUNK = 1 << 20


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _read_manifest(dest_dir: Path) -> dict[str, dict[str, str | int]]:
    path = dest_dir / MANIFEST_NAME
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def _is_valid(path: Path, expected_size: int | None, entry: dict[str, str | int] | None) -> bool:
    if not path.exists() or entry is None:
        return False
    size = path.stat().st_size
    if size != entry["size_bytes"] or (expected_size and size != expected_size):
        return False
    return _sha256(path) == entry["sha256"]


def _record(dest_dir: Path, filename: str, sha256: str, size: int, url: str) -> None:
    manifest = _read_manifest(dest_dir)
    manifest[filename] = {"sha256": sha256, "size_bytes": size, "url": url}
    (dest_dir / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2, sort_keys=True))


def ensure_file(source: Source, dest_dir: Path, client: httpx.Client | None = None) -> Path:
    """파일이 없거나 manifest와 다르면 다시 받는다. 최종 경로에는 완전한 파일만 존재한다."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    final = dest_dir / source.filename
    if _is_valid(final, source.size_bytes, _read_manifest(dest_dir).get(source.filename)):
        return final

    part = final.with_name(final.name + ".part")
    owns_client = client is None
    http = client or httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60.0))
    try:
        digest = hashlib.sha256()
        with http.stream("GET", source.url) as response:
            response.raise_for_status()
            with part.open("wb") as f:
                for chunk in response.iter_bytes(_CHUNK):
                    f.write(chunk)
                    digest.update(chunk)
        size = part.stat().st_size
        if source.size_bytes and size != source.size_bytes:
            raise ValueError(f"{source.filename}: expected {source.size_bytes} B, got {size} B")
        part.replace(final)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    finally:
        if owns_client:
            http.close()

    _record(dest_dir, source.filename, digest.hexdigest(), size, source.url)
    return final


_ZIP_TAIL = 1 << 16  # 끝 레코드와 주석이 들어가는 최대 길이 근처
_ZIP64 = 0xFFFFFFFF


def _range(http: httpx.Client, url: str, spec: str) -> bytes:
    response = http.get(url, headers={"Range": f"bytes={spec}"})
    response.raise_for_status()
    if response.status_code != 206:
        raise ValueError(f"{url}: the server ignored the Range request")
    return response.content


def _zip64_fields(extra: bytes, wanted: list[int]) -> list[int]:
    """zip64 확장 필드(0x0001)에서, 32비트 칸이 0xFFFFFFFF였던 값들을 순서대로 읽는다."""
    position = 0
    while position + 4 <= len(extra):
        header, length = struct.unpack_from("<HH", extra, position)
        if header == 1:
            values = list(struct.unpack_from(f"<{length // 8}Q", extra, position + 4))
            return [values.pop(0) if value == _ZIP64 else value for value in wanted]
        position += 4 + length
    return wanted


def _find_zip_member(http: httpx.Client, url: str, suffix: str) -> tuple[int, int, int, int, int]:
    """(방식, 압축 크기, 원래 크기, CRC-32, 로컬 헤더 위치). 중앙 디렉터리만 읽는다."""
    tail = _range(http, url, f"-{_ZIP_TAIL}")
    end = tail.rfind(b"PK\x05\x06")
    if end < 0:
        raise ValueError(f"{url}: not a zip file")
    count, size, offset = struct.unpack_from("<HII", tail, end + 10)
    if offset == _ZIP64 or count == 0xFFFF:
        end64 = tail.rfind(b"PK\x06\x06")
        if end64 < 0:
            raise ValueError(f"{url}: zip64 end record not found")
        count, size, offset = struct.unpack_from("<QQQ", tail, end64 + 32)
    directory = _range(http, url, f"{offset}-{offset + size - 1}")
    position = 0
    for _ in range(count):
        method, _, _, crc, packed, unpacked, name_len, extra_len, comment_len = struct.unpack_from(
            "<HHHIIIHHH", directory, position + 10
        )
        (local,) = struct.unpack_from("<I", directory, position + 42)
        name = directory[position + 46 : position + 46 + name_len].decode("utf-8", "replace")
        extra = directory[position + 46 + name_len : position + 46 + name_len + extra_len]
        position += 46 + name_len + extra_len + comment_len
        if name.endswith(suffix) and not name.startswith("__MACOSX/"):
            unpacked, packed, local = _zip64_fields(extra, [unpacked, packed, local])
            return method, packed, unpacked, crc, local
    raise ValueError(f"{url}: no member ending with {suffix}")


def ensure_zip_member(
    source: ZipMemberSource, dest_dir: Path, client: httpx.Client | None = None
) -> Path:
    """원격 zip에서 파일 하나만 Range 요청으로 받아 푼다. zip 전체는 받지 않는다.

    ensure_file과 같이 manifest와 맞는 파일은 다시 받지 않고, 최종 경로에는 완전한 파일만 둔다.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    final = dest_dir / source.filename
    if _is_valid(final, None, _read_manifest(dest_dir).get(source.filename)):
        return final

    owns_client = client is None
    http = client or httpx.Client(follow_redirects=True, timeout=httpx.Timeout(300.0))
    try:
        method, packed, unpacked, crc, local = _find_zip_member(
            http, source.url, source.member_suffix
        )
        name_len, extra_len = struct.unpack_from(
            "<HH", _range(http, source.url, f"{local}-{local + 29}"), 26
        )
        start = local + 30 + name_len + extra_len
        raw = _range(http, source.url, f"{start}-{start + packed - 1}") if packed else b""
    finally:
        if owns_client:
            http.close()
    if method not in (0, 8):
        raise ValueError(f"{source.filename}: unsupported zip compression method {method}")
    data = raw if method == 0 else zlib.decompress(raw, -zlib.MAX_WBITS)
    if len(data) != unpacked or zlib.crc32(data) != crc:
        raise ValueError(f"{source.filename}: size or CRC does not match the zip directory")

    part = final.with_name(final.name + ".part")
    try:
        part.write_bytes(data)
        part.replace(final)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    _record(dest_dir, source.filename, hashlib.sha256(data).hexdigest(), len(data), source.url)
    return final


def fetch_sfs(data_dir: Path) -> None:
    """Artemis III 후보 지역 13곳의 5 m Shape-from-Shading DEM을 DATA_DIR/dem/sfs에 받는다."""
    for source in SFS_SOURCES:
        print(f"[sfs] {source.filename}", flush=True)
        ensure_zip_member(source, data_dir / "dem" / "sfs")


def fetch_wide(data_dir: Path) -> None:
    """60°S까지 덮는 240 m DEM을 DATA_DIR/dem에 받는다 (넓은 구역의 경사 타일과 햇빛 지도용)."""
    for source in DEM_SOURCES[WIDE_DEM]:
        print(f"[dem] {source.filename}", flush=True)
        ensure_file(source, data_dir / "dem")


def fetch_all(data_dir: Path, dem: str = "80s_80m", fallback_dem: str | None = "75s_120m") -> None:
    """주 DEM, 보충 DEM, SPICE 커널을 모두 내려받는다. 보충 DEM은 80 m DEM 바깥을 메운다."""
    for name in (dem, fallback_dem):
        if name is not None and name not in DEM_SOURCES:
            raise ValueError(f"unknown DEM '{name}'. choices: {', '.join(DEM_SOURCES)}")
    names = [dem] + ([fallback_dem] if fallback_dem is not None and fallback_dem != dem else [])
    for name in names:
        for source in DEM_SOURCES[name]:
            print(f"[dem] {source.filename}", flush=True)
            ensure_file(source, data_dir / "dem")
    for source in SPICE_SOURCES:
        print(f"[spice] {source.filename}", flush=True)
        ensure_file(source, data_dir / "spice")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dem", default="80s_80m", choices=list(DEM_SOURCES))
    parser.add_argument(
        "--fallback-dem",
        default="75s_120m",
        choices=[*DEM_SOURCES, "none"],
        help="주 DEM 바깥을 메우는 보충 DEM (기본 75s_120m, none이면 받지 않음)",
    )
    parser.add_argument(
        "--sfs",
        action="store_true",
        help="후보 지역 13곳의 5 m DEM도 받는다 (약 400 MB, 근접 화면의 20 m·5 m 타일용)",
    )
    parser.add_argument(
        "--wide",
        action="store_true",
        help="60°S까지 덮는 240 m DEM도 받는다 (약 240 MB, 85°S 밖의 경사 타일과 햇빛 지도용)",
    )
    args = parser.parse_args()
    fallback = None if args.fallback_dem == "none" else args.fallback_dem
    fetch_all(Settings().data_dir, args.dem, fallback)
    if args.wide:
        fetch_wide(Settings().data_dir)
    if args.sfs:
        fetch_sfs(Settings().data_dir)
    print("done")


if __name__ == "__main__":
    main()
