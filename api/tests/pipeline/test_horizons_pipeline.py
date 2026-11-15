from pathlib import Path

import numpy as np
import pytest

from lunar_margin.engine.candidates.config import Roi, SearchConfig
from lunar_margin.pipeline.candidates import SearchOutcome, run_search
from lunar_margin.pipeline.horizons import build_for_config, table_spec_for

TINY = SearchConfig(
    roi=Roi(min_lat_deg=-90.0, max_lat_deg=-89.95),  # 극에서 약 1.5 km
    grid_spacing_m=500.0,
    coarse_spacing_m=1000.0,
    refine_fraction=0.5,
    min_separation_m=1000.0,
    top_k=4,
    fallback_dem=None,
)


def _link_data(data_dir: Path, root: Path) -> Path:
    """실제 데이터를 가리키는 임시 DATA_DIR (테이블은 여기에만 쓴다)."""
    root.mkdir()
    for sub in ("dem", "spice"):
        (root / sub).mkdir()
        for item in (data_dir / sub).iterdir():
            (root / sub / item.name).symlink_to(item.resolve())
    return root


@pytest.fixture
def data_copy(data_dir: Path, tmp_path: Path) -> Path:
    return _link_data(data_dir, tmp_path / "data")


# 탐색과 테이블 빌드는 느려서 같은 입력이면 모듈에서 한 번만 계산해 나눠 쓴다.
@pytest.fixture(scope="module")
def without_table(data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> SearchOutcome:
    root = _link_data(data_dir, tmp_path_factory.mktemp("no-table") / "data")
    return run_search(TINY, root, log=lambda _: None)


@pytest.fixture(scope="module")
def built(data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path, list[str]]:
    """TINY용 테이블을 한 번 만든 DATA_DIR, 테이블 경로, 빌드 로그."""
    root = _link_data(data_dir, tmp_path_factory.mktemp("built") / "data")
    lines: list[str] = []
    path = build_for_config(TINY, root, workers=1, log=lines.append)
    return root, path, lines


def test_the_table_spec_follows_the_config_and_the_dem_files(data_copy: Path) -> None:
    spec = table_spec_for(TINY, data_copy)

    assert spec.roi == TINY.roi and spec.spacing_m == 500.0
    assert spec.azimuth_step_deg == TINY.fine_azimuth_step_deg
    assert spec.max_range_m == TINY.max_range_m and spec.observer_height_m == 0.0
    assert "ldem_80s_80m_float.img" in spec.dem_id
    other = table_spec_for(TINY.model_copy(update={"observer_height_m": 2.0}), data_copy)
    assert other.table_id() != spec.table_id()


def test_a_search_without_a_table_warns_and_still_works(without_table: SearchOutcome) -> None:
    outcome = without_table

    assert outcome.source.horizon_table is None
    assert any("수평선 테이블" in w and "pipeline.horizons" in w for w in outcome.summary.warnings)


def test_a_built_table_is_found_and_gives_the_same_candidates(
    without_table: SearchOutcome, built: tuple[Path, Path, list[str]]
) -> None:
    before = without_table
    root, path, _ = built

    after = run_search(TINY, root, log=lambda _: None)

    assert path.parent == root / "horizons"
    assert after.source.horizon_table == path.name
    assert not any("수평선 테이블" in w for w in after.summary.warnings)
    # 후보 지점(id)과 순위는 같고, 수평선을 0.01° 단위로 저장하므로 지표는 거의 같다
    assert np.array_equal(before.rank, after.rank)
    assert np.allclose(
        before.field.sun_fraction, after.field.sun_fraction, atol=0.01, equal_nan=True
    )
    assert np.allclose(
        before.field.earth_fraction, after.field.earth_fraction, atol=0.01, equal_nan=True
    )


def test_a_table_for_other_parameters_is_not_used(built: tuple[Path, Path, list[str]]) -> None:
    root, _, _ = built

    other = run_search(TINY.model_copy(update={"observer_height_m": 2.0}), root, log=lambda _: None)

    assert other.source.horizon_table is None


def test_building_reports_progress_and_replaces_nothing_when_it_already_exists(
    built: tuple[Path, Path, list[str]],
) -> None:
    root, first, first_lines = built
    mtime = (first / "meta.json").stat().st_mtime_ns
    lines: list[str] = []

    again = build_for_config(TINY, root, workers=1, log=lines.append)

    assert first_lines
    assert again == first and (again / "meta.json").stat().st_mtime_ns == mtime
    assert any("이미 있" in line for line in lines)


def test_build_requires_the_dem_files(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match=r"pipeline\.fetch"):
        build_for_config(TINY, tmp_path, workers=1, log=lambda _: None)


# --- Storage 올리기·받기 (설정에서 table id를 정한다) ----------------------------------------


def test_upload_uses_the_table_id_of_the_current_config(
    built: tuple[Path, Path, list[str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    import lunar_margin.pipeline.horizons as horizons
    from lunar_margin.pipeline.table_storage import StorageConfig

    root, table, _ = built
    seen: list[Path] = []

    def fake_upload(directory: Path, cfg: StorageConfig, **kw: object) -> str:
        seen.append(directory)
        return directory.name

    monkeypatch.setattr(horizons, "upload_table", fake_upload)

    result = horizons.upload_for_config(
        TINY, root, StorageConfig("http://x", "k", "b"), log=lambda _: None
    )

    assert seen == [table] and result == table.name


def test_upload_without_a_local_table_says_to_build_it_first(data_copy: Path) -> None:
    import lunar_margin.pipeline.horizons as horizons
    from lunar_margin.pipeline.table_storage import StorageConfig

    with pytest.raises(FileNotFoundError, match=r"pipeline\.horizons"):
        horizons.upload_for_config(
            TINY, data_copy, StorageConfig("http://x", "k", "b"), log=lambda _: None
        )


def test_download_asks_for_the_table_id_of_the_current_config(
    data_copy: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import lunar_margin.pipeline.horizons as horizons
    from lunar_margin.pipeline.table_storage import StorageConfig

    calls: list[tuple[str, Path]] = []

    def fake(table_id: str, dest: Path, cfg: StorageConfig, **kw: object) -> Path:
        calls.append((table_id, dest))
        return dest / table_id

    monkeypatch.setattr(horizons, "download_table", fake)

    horizons.download_for_config(
        TINY, data_copy, StorageConfig("http://x", "k", "b"), log=lambda _: None
    )

    assert calls == [(table_spec_for(TINY, data_copy).table_id(), data_copy / "horizons")]


def test_a_search_without_a_table_points_to_both_ways_of_getting_one(
    without_table: SearchOutcome,
) -> None:
    warning = next(w for w in without_table.summary.warnings if "수평선 테이블" in w)
    assert "pipeline.horizons --download" in warning and "pipeline.horizons`" in warning
