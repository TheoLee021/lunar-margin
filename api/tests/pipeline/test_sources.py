import pytest

from lunar_margin.pipeline.sources import DEM_SOURCES


@pytest.mark.parametrize("name", sorted(DEM_SOURCES))
def test_each_dem_has_an_image_with_size_and_a_label(name: str) -> None:
    img, lbl = DEM_SOURCES[name]

    assert img.filename.endswith("_float.img") and img.size_bytes
    assert lbl.filename == img.filename.removesuffix(".img") + ".lbl"
    assert img.url.endswith(img.filename) and lbl.url.endswith(lbl.filename)


def test_75s_120m_covers_the_whole_south_polar_roi() -> None:
    img, _ = DEM_SOURCES["75s_120m"]

    # 75°S 이남, 120 m/px, 7624 x 7624 픽셀 (4 바이트)
    assert img.size_bytes == 7624 * 7624 * 4
