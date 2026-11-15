"""실제 LOLA DEM으로 축 방향이 맞는지 확인한다 (DEM 없으면 다운로드)."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from lunar_margin.engine.dem import PolarDem


@pytest.fixture(scope="module")
def dem(data_dir: Path) -> Iterator[PolarDem]:
    yield PolarDem.from_files(
        data_dir / "dem" / "ldem_80s_80m_float.img",
        data_dir / "dem" / "ldem_80s_80m_float.lbl",
    )


def test_malapert_massif_is_high(dem: PolarDem) -> None:
    # Malapert 산: 약 85.99°S 0.12°E, 해발 약 +5 km
    assert dem.height_at(-85.99, 0.12) > 3000.0


@pytest.mark.parametrize(
    ("name", "lat", "lon"),
    [("Shoemaker", -88.1, 44.9), ("Haworth", -87.5, 355.0), ("Faustini", -87.3, 77.0)],
)
def test_permanently_shadowed_craters_are_deep(
    dem: PolarDem, name: str, lat: float, lon: float
) -> None:
    assert dem.height_at(lat, lon) < -2000.0, name
