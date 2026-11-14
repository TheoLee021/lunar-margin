"""수평선 테이블 사전 계산: 한 번 계산해 DATA_DIR/horizons/{id}/에 두면 이후 탐색이 읽기만 한다.

실행: uv run python -m lunar_margin.pipeline.horizons [--config cfg.json] [--workers N]
기본 설정(ROI 85°S 이남, 500 m 격자, 방위 1°)이면 약 29만 지점이고 14코어에서 20분 안팎이 걸린다.
"""

import argparse
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.engine.candidates.field import open_dem
from lunar_margin.engine.candidates.horizon_table import (
    HorizonTableSpec,
    build_horizon_table,
)
from lunar_margin.pipeline.sources import DEM_SOURCES, Source

TABLES_DIR = "horizons"


@dataclass(frozen=True)
class DemSelection:
    pairs: list[tuple[Path, Path]]  # 첫째가 주 DEM, 둘째(있으면)가 보충 DEM
    primary: Source
    fallback: Source | None
    warnings: list[str]


def resolve_dems(config: SearchConfig, data_dir: Path) -> DemSelection:
    """설정의 DEM 파일을 찾는다. 보충 DEM이 없으면 경고만 남기고 주 DEM만 쓴다."""
    if config.dem not in DEM_SOURCES:
        raise ValueError(f"unknown DEM '{config.dem}'. choices: {', '.join(DEM_SOURCES)}")
    img, lbl = DEM_SOURCES[config.dem]
    primary = (data_dir / "dem" / img.filename, data_dir / "dem" / lbl.filename)
    if not all(p.exists() for p in primary):
        raise FileNotFoundError(
            f"DEM files not found in {data_dir / 'dem'}; "
            f"run `uv run python -m lunar_margin.pipeline.fetch --dem {config.dem}`"
        )
    pairs = [primary]
    warnings: list[str] = []
    fallback: Source | None = None
    if config.fallback_dem is not None:
        if config.fallback_dem not in DEM_SOURCES:
            raise ValueError(f"unknown DEM '{config.fallback_dem}'")
        fb_img, fb_lbl = DEM_SOURCES[config.fallback_dem]
        fb = (data_dir / "dem" / fb_img.filename, data_dir / "dem" / fb_lbl.filename)
        if all(p.exists() for p in fb):
            pairs.append(fb)
            fallback = fb_img
        else:
            warnings.append(
                f"보충 DEM({fb_img.filename})이 없어 주 DEM 바깥의 지형은 알 수 없습니다. "
                f"`uv run python -m lunar_margin.pipeline.fetch --dem {config.fallback_dem}`로 "
                "받으면 수평선이 ROI 전체에서 완전해집니다."
            )
    return DemSelection(pairs=pairs, primary=img, fallback=fallback, warnings=warnings)


def table_spec_for(config: SearchConfig, data_dir: Path) -> HorizonTableSpec:
    selection = resolve_dems(config, data_dir)
    dem_id = "+".join(s.filename for s in (selection.primary, selection.fallback) if s is not None)
    return HorizonTableSpec(
        dem_id=dem_id,
        roi=config.roi,
        spacing_m=config.grid_spacing_m,
        azimuth_step_deg=config.fine_azimuth_step_deg,
        max_range_m=config.max_range_m,
        observer_height_m=config.observer_height_m,
    )


def build_for_config(
    config: SearchConfig,
    data_dir: Path,
    *,
    workers: int | None = None,
    log: Callable[[str], None] = print,
) -> Path:
    """설정에 맞는 수평선 테이블을 만든다. 이미 있으면 다시 만들지 않는다."""
    selection = resolve_dems(config, data_dir)
    spec = table_spec_for(config, data_dir)
    directory = data_dir / TABLES_DIR / spec.table_id()
    if (directory / "meta.json").exists():
        log(f"수평선 테이블이 이미 있습니다: {directory}")
        return directory
    count = workers or config.workers or os.cpu_count() or 1
    dem = open_dem(selection.pairs)
    log(f"수평선 테이블 계산 시작 (id {spec.table_id()}, 워커 {count})")
    last = [-1]

    def progress(done: int, total: int) -> None:
        percent = int(100 * done / total)
        if percent // 5 != last[0] // 5 or done == total:
            last[0] = percent
            log(f"  {done:,} / {total:,} 지점 ({percent}%)")

    build_horizon_table(
        directory, spec, dem, workers=count, dem_pairs=selection.pairs, on_progress=progress
    )
    log(f"완료: {directory}")
    return directory


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="SearchConfig JSON (생략하면 기본값)")
    parser.add_argument("--workers", type=int, help="프로세스 수 (기본: CPU 코어 수)")
    args = parser.parse_args()
    config = (
        SearchConfig.model_validate_json(args.config.read_text()) if args.config else SearchConfig()
    )
    build_for_config(config, Settings().data_dir, workers=args.workers)


if __name__ == "__main__":
    main()
