"""후보지를 `{"lat": -86.764, "lon_e": 337.223, ...지표}` 형태의 평평한 목록으로 내보낸다.

lat은 남쪽이 음수인 위도(도), lon_e는 동경 0~360(도). 지표 값이 계산되지 않은 곳은 null이다.
"""

import argparse
from pathlib import Path

from pydantic import BaseModel, ConfigDict, TypeAdapter

from lunar_margin.app.settings import Settings
from lunar_margin.pipeline.candidate_schema import CandidatesDocument

_LIST = TypeAdapter(list["SimpleCandidate"])


class SimpleCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rank: int
    id: str
    lat: float
    lon_e: float
    sun_fraction: float | None
    sun_longest_dark_hours: float | None
    sun_windows_per_24h: float | None
    sun_mean_elevation_deg: float | None
    earth_fraction: float | None
    earth_longest_blackout_hours: float | None
    earth_windows_per_24h: float | None
    earth_mean_elevation_deg: float | None
    score: float | None
    region_id: int
    horizon_complete: bool
    roughness_p95_m: float | None = None


def simple_candidates(document: CandidatesDocument) -> list[SimpleCandidate]:
    return [
        SimpleCandidate(
            rank=c.rank,
            id=c.id,
            lat=round(c.lat_deg, 3),
            lon_e=round(c.lon_deg, 3),
            sun_fraction=c.sun.fraction,
            sun_longest_dark_hours=c.sun.longest_dark_hours,
            sun_windows_per_24h=c.sun.windows_per_24h,
            sun_mean_elevation_deg=c.sun.mean_elevation_deg,
            earth_fraction=c.earth.fraction,
            earth_longest_blackout_hours=c.earth.longest_blackout_hours,
            earth_windows_per_24h=c.earth.windows_per_24h,
            earth_mean_elevation_deg=c.earth.mean_elevation_deg,
            score=c.score.total,
            region_id=c.region_id,
            horizon_complete=c.data_quality.horizon_complete,
            roughness_p95_m=None if c.terrain is None else c.terrain.roughness_p95_m,
        )
        for c in document.candidates
    ]


def simple_json(document: CandidatesDocument) -> bytes:
    return _LIST.dump_json(simple_candidates(document), indent=2) + b"\n"


def export_simple(run_dir: Path) -> Path:
    """이미 만들어진 실행 폴더의 candidates.json에서 candidates_simple.json을 (다시) 만든다."""
    document = CandidatesDocument.model_validate_json((run_dir / "candidates.json").read_text())
    out = run_dir / "candidates_simple.json"
    out.write_bytes(simple_json(document))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", default="default")
    parser.add_argument(
        "--dir", type=Path, help="실행 폴더 (생략하면 DATA_DIR/candidates/{run-id})"
    )
    args = parser.parse_args()
    run_dir = args.dir or Settings().data_dir / "candidates" / args.run_id
    print(export_simple(run_dir))


if __name__ == "__main__":
    main()
