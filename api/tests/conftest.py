from collections.abc import Iterator
from pathlib import Path

import pytest

from lunar_margin.app.settings import Settings
from lunar_margin.engine.ephemeris import load_kernels
from lunar_margin.pipeline.fetch import fetch_all


@pytest.fixture(scope="session")
def data_dir() -> Path:
    """NASA 원천 데이터 위치. 없으면 내려받는다 (첫 실행은 네트워크 필요)."""
    fetch_all(Settings().data_dir)
    return Settings().data_dir


@pytest.fixture(scope="session")
def spice_kernels(data_dir: Path) -> Iterator[None]:
    load_kernels(data_dir / "spice")
    yield
