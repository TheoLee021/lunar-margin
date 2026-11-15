"""Incremental, exact horizon profiles shared across dates and search regions.

Only completed chunks are committed. SQLite WAL permits independent worker
processes to read and atomically append without holding locks during ray tracing.
"""

import hashlib
import json
import sqlite3
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from lunar_margin.engine.horizon import HorizonProfile

CACHE_VERSION = 1  # Bump when the ray-tracing algorithm or stored representation changes.


def cache_path(
    root: Path,
    dem_files: Sequence[tuple[Path, Path]],
    *,
    azimuth_step_deg: float,
    max_range_m: float,
    observer_height_m: float,
) -> Path:
    # Date, constraints, grid spacing and ROI do not change a point's horizon.
    # Both DEM contents and label metadata must retain the same identity.
    files: list[tuple[str, int, int, int]] = []
    for pair in dem_files:
        for path in pair:
            stat = path.stat()
            files.append((str(path.resolve()), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))
    identity = json.dumps(
        [
            CACHE_VERSION,
            files,
            float(azimuth_step_deg),
            float(max_range_m),
            float(observer_height_m),
        ]
    )
    digest = hashlib.sha256(identity.encode()).hexdigest()[:24]
    return root / f"height-{observer_height_m:g}m-{digest}.sqlite3"


class HorizonCache:
    def __init__(self, path: Path, azimuth_step_deg: float) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, timeout=120)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS profiles ("
            "lat TEXT NOT NULL, lon TEXT NOT NULL, elevation BLOB NOT NULL, "
            "complete INTEGER NOT NULL, PRIMARY KEY (lat, lon)) WITHOUT ROWID"
        )
        self.connection.commit()
        self.azimuth = np.arange(0.0, 360.0, azimuth_step_deg)
        self.pending: dict[tuple[str, str], tuple[bytes, int]] = {}
        self.hits = 0
        self.written = 0

    @staticmethod
    def key(lat: float, lon: float) -> tuple[str, str]:
        return float(lat + 0.0).hex(), float(lon % 360.0 + 0.0).hex()

    def get(self, lat: float, lon: float) -> HorizonProfile | None:
        key = self.key(lat, lon)
        row = self.pending.get(key)
        if row is None:
            row = self.connection.execute(
                "SELECT elevation, complete FROM profiles WHERE lat=? AND lon=?", key
            ).fetchone()
        if row is None:
            return None
        self.hits += 1
        elevation = np.frombuffer(row[0], dtype="<f8").copy()
        if elevation.shape != self.azimuth.shape or not np.isfinite(elevation).all():
            raise ValueError("invalid cached horizon profile")
        return HorizonProfile(self.azimuth, elevation, complete=bool(row[1]))

    def put(self, lat: float, lon: float, profile: HorizonProfile) -> None:
        self.pending[self.key(lat, lon)] = (
            profile.elevation_deg.astype("<f8").tobytes(),
            int(profile.complete),
        )

    def flush(self) -> None:
        if not self.pending:
            return
        before = self.connection.total_changes
        with self.connection:
            self.connection.executemany(
                "INSERT OR IGNORE INTO profiles VALUES (?, ?, ?, ?)",
                [(a, b, value, complete) for (a, b), (value, complete) in self.pending.items()],
            )
        self.written += self.connection.total_changes - before
        self.pending.clear()

    def close(self) -> None:
        self.connection.close()
