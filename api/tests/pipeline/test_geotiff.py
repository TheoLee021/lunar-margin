"""GDAL이 쓰는 형식의 실수 GeoTIFF(타일, deflate, 부동소수점 예측자)를 읽는다."""

import struct
import zlib
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.pipeline.geotiff import read_float_geotiff


def write_geotiff(
    path: Path,
    values: NDArray[np.float32],
    *,
    left_m: float,
    top_m: float,
    pixel_size_m: float,
    tile: int = 4,
    nodata: float | None = None,
    compression: int = 8,
    predictor: int = 3,
) -> None:
    """TIFF 6.0 + Adobe TechNote 3(부동소수점 예측자)대로 쓴 최소 GeoTIFF."""
    height, width = values.shape
    tiles: list[bytes] = []
    for top in range(0, height, tile):
        for left in range(0, width, tile):
            block = np.zeros((tile, tile), dtype=">f4")  # 가장자리 타일은 0으로 채운다
            part = values[top : top + tile, left : left + tile]
            block[: part.shape[0], : part.shape[1]] = part
            rows = bytearray()
            for row in block:
                # 한 행의 바이트를 자리별로 모은다: 모든 픽셀의 최상위 바이트, 그다음 바이트, ...
                planes = np.frombuffer(row.tobytes(), dtype=np.uint8).reshape(tile, 4).T
                flat = planes.reshape(-1).astype(np.int16)
                flat[1:] -= flat[:-1].copy()  # 앞 바이트와의 차이
                rows += (flat & 0xFF).astype(np.uint8).tobytes()
            tiles.append(zlib.compress(bytes(rows)))

    entries: list[tuple[int, int, int, bytes]] = []  # (태그, 형식, 개수, 값 바이트)

    def add(tag: int, kind: str, *numbers: float) -> None:
        code = {"H": 3, "I": 4, "d": 12}[kind]
        entries.append((tag, code, len(numbers), struct.pack(f"<{len(numbers)}{kind}", *numbers)))

    add(256, "I", width)
    add(257, "I", height)
    add(258, "H", 32)
    add(259, "H", compression)
    add(277, "H", 1)
    add(317, "H", predictor)
    add(322, "I", tile)
    add(323, "I", tile)
    add(339, "H", 3)
    add(33550, "d", pixel_size_m, pixel_size_m, 0.0)
    add(33922, "d", 0.0, 0.0, 0.0, left_m, top_m, 0.0)
    if nodata is not None:
        text = f"{nodata!r}\0".encode()
        entries.append((42113, 2, len(text), text))

    header = 8
    directory = 2 + 12 * (len(entries) + 2) + 4
    position = header + directory
    blobs = bytearray()

    def place(data: bytes) -> int:
        nonlocal position
        offset = position
        blobs.extend(data)
        position += len(data)
        return offset

    packed: list[tuple[int, bytes]] = []
    for tag, code, count, data in entries:
        value = data.ljust(4, b"\0") if len(data) <= 4 else struct.pack("<I", place(data))
        packed.append((tag, struct.pack("<HHI", tag, code, count) + value))
    offsets = [place(data) for data in tiles]
    counts = [len(data) for data in tiles]
    for tag, numbers in ((324, offsets), (325, counts)):
        data = struct.pack(f"<{len(numbers)}I", *numbers)
        value = data if len(data) == 4 else struct.pack("<I", place(data))
        packed.append((tag, struct.pack("<HHI", tag, 4, len(numbers)) + value))
    packed.sort()
    body = struct.pack("<H", len(packed)) + b"".join(entry for _, entry in packed) + b"\0\0\0\0"
    path.write_bytes(b"II*\0" + struct.pack("<I", header) + body + bytes(blobs))


def test_reads_heights_and_where_the_raster_lies(tmp_path: Path) -> None:
    rng = np.random.default_rng(7)
    values = (rng.normal(size=(6, 10)) * 1500.0).astype(np.float32)  # 타일(4)의 배수가 아닌 크기
    write_geotiff(tmp_path / "dem.tif", values, left_m=-19_000.0, top_m=-4_000.0, pixel_size_m=5.0)

    raster = read_float_geotiff(tmp_path / "dem.tif")

    assert raster.heights.dtype == np.float32
    assert np.array_equal(raster.heights, values)
    assert (raster.left_m, raster.top_m, raster.pixel_size_m) == (-19_000.0, -4_000.0, 5.0)


def test_nodata_pixels_become_nan(tmp_path: Path) -> None:
    values = np.arange(16, dtype=np.float32).reshape(4, 4)
    values[1, 2] = np.float32(-3.4028234663852886e38)
    write_geotiff(
        tmp_path / "dem.tif",
        values,
        left_m=0.0,
        top_m=0.0,
        pixel_size_m=5.0,
        nodata=-3.4028234663852886e38,
    )

    heights = read_float_geotiff(tmp_path / "dem.tif").heights

    assert np.isnan(heights[1, 2]) and np.isnan(heights).sum() == 1
    assert heights[3, 3] == 15.0


@pytest.mark.parametrize(("compression", "predictor"), [(5, 3), (8, 2)])
def test_a_layout_it_cannot_read_is_an_error_not_wrong_heights(
    tmp_path: Path, compression: int, predictor: int
) -> None:
    write_geotiff(
        tmp_path / "dem.tif",
        np.ones((4, 4), dtype=np.float32),
        left_m=0.0,
        top_m=0.0,
        pixel_size_m=5.0,
        compression=compression,
        predictor=predictor,
    )

    with pytest.raises(ValueError, match="unsupported"):
        read_float_geotiff(tmp_path / "dem.tif")
