"""Opt-in acquisition of one Diviner PCP temperature table; see docs/diviner-data.md.

Run: python -m lunar_margin.pipeline.diviner
"""

import argparse
import hashlib
from pathlib import Path

import httpx

from lunar_margin.app.settings import Settings
from lunar_margin.pipeline.fetch import ensure_file
from lunar_margin.pipeline.sources import Source

_STEM = "pcp_avg_tbol_pols_sum_ltim01_240"
_BASE = (
    "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/"
    "data_derived_pcp/diurnal/ltim/pols"
)
# Exact official bytes verified against the PDS bundle MD5 inventory on 2026-11-15.
_LABEL_SHA256 = "17d9d1a8bac3963543aa59446d818253caa912b4dcf4edb4d9f45f51f1363538"
_TABLE_SHA256 = "414354cb2334b62161e895fe0f36369fdee77af13b0c5f333b86ddb05a0f618b"
_LABEL = Source("Diviner PCP label", f"{_BASE}/{_STEM}.lbl", f"{_STEM}.lbl", 3637)
_TABLE = Source("Diviner PCP temperature", f"{_BASE}/{_STEM}.tab", f"{_STEM}.tab", 212_653_759)


def _verify(path: Path, expected: str, kind: str) -> None:
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        path.unlink()
        raise ValueError(f"Diviner {kind}: checksum mismatch; retry or review the PDS product")


def fetch_diviner(data_dir: Path, client: httpx.Client | None = None) -> tuple[Path, Path]:
    """Fetch label + 213 MB table into DATA_DIR/diviner using the existing manifest pipeline.

    The pinned label verifies identity, layout and scientific metadata before the table
    request. Both fresh and cached files must match the reviewed official checksums.
    """
    destination = data_dir / "diviner"
    label = ensure_file(_LABEL, destination, client)
    _verify(label, _LABEL_SHA256, "label")
    table = ensure_file(_TABLE, destination, client)
    _verify(table, _TABLE_SHA256, "table")
    return label, table


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Settings().data_dir)
    args = parser.parse_args()
    for path in fetch_diviner(args.data_dir):
        print(path)


if __name__ == "__main__":
    main()
