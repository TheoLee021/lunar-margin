"""NASA 원천 데이터를 DATA_DIR로 내려받고 크기·sha256을 manifest.json에 기록한다.

실행: uv run python -m lunar_margin.pipeline.fetch
"""

import argparse
import hashlib
import json
from pathlib import Path

import httpx

from lunar_margin.app.settings import Settings
from lunar_margin.pipeline.sources import DEM_SOURCES, SPICE_SOURCES, Source

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


def _is_valid(path: Path, source: Source, entry: dict[str, str | int] | None) -> bool:
    if not path.exists() or entry is None:
        return False
    size = path.stat().st_size
    if size != entry["size_bytes"] or (source.size_bytes and size != source.size_bytes):
        return False
    return _sha256(path) == entry["sha256"]


def ensure_file(source: Source, dest_dir: Path, client: httpx.Client | None = None) -> Path:
    """파일이 없거나 manifest와 다르면 다시 받는다. 최종 경로에는 완전한 파일만 존재한다."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    final = dest_dir / source.filename
    manifest = _read_manifest(dest_dir)
    if _is_valid(final, source, manifest.get(source.filename)):
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

    manifest[source.filename] = {
        "sha256": digest.hexdigest(),
        "size_bytes": size,
        "url": source.url,
    }
    (dest_dir / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2, sort_keys=True))
    return final


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
    args = parser.parse_args()
    fallback = None if args.fallback_dem == "none" else args.fallback_dem
    fetch_all(Settings().data_dir, args.dem, fallback)
    print("done")


if __name__ == "__main__":
    main()
