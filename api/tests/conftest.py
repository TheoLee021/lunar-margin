import fcntl
from collections.abc import Iterator
from pathlib import Path

import pytest

from lunar_margin.app.settings import Settings
from lunar_margin.engine.ephemeris import load_kernels
from lunar_margin.pipeline.fetch import fetch_all


@pytest.fixture(scope="session")
def data_dir() -> Path:
    """NASA 원천 데이터 위치. 없으면 내려받는다 (첫 실행은 네트워크 필요).

    pytest-xdist worker들이 같은 파일을 동시에 내려받지 않도록 파일 잠금으로 한 번에 하나만 받는다.
    """
    data_dir = Settings().data_dir
    data_dir.mkdir(parents=True, exist_ok=True)
    with (data_dir / ".fetch.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        fetch_all(data_dir)
    return data_dir


@pytest.fixture(scope="session")
def spice_kernels(data_dir: Path) -> Iterator[None]:
    load_kernels(data_dir / "spice")
    yield
