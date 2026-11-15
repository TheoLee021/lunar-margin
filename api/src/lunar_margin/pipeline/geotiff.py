"""실수 GeoTIFF 읽기: GDAL이 쓰는 한 가지 배치만 지원하는 최소 리더.

지원: 리틀엔디언 TIFF, 단일 밴드 32비트 실수, 타일, deflate 압축, 부동소수점 예측자(3).
PGDA의 Shape-from-Shading 고도 래스터(`*_GLDELEV_005.tif`)가 이 배치다 (docs/data.md).
다른 배치는 잘못 읽는 대신 ValueError를 낸다.
"""

import mmap
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

_TYPE_FORMATS = {1: "B", 2: "s", 3: "H", 4: "I", 12: "d"}
_DEFLATE = (8, 32946)


@dataclass(frozen=True)
class GeoRaster:
    """heights[row, col]의 픽셀은 x = left_m + (col + 0.5) * pixel_size_m,
    y = top_m - (row + 0.5) * pixel_size_m 에 중심이 있다 (투영 좌표, 값이 없는 곳은 NaN)."""

    heights: NDArray[np.float32]
    left_m: float
    top_m: float
    pixel_size_m: float


def _tags(data: bytes | mmap.mmap) -> dict[int, tuple[float, ...] | bytes]:
    if data[:4] != b"II*\0":
        raise ValueError("unsupported TIFF: expected little-endian classic TIFF")
    (offset,) = struct.unpack_from("<I", data, 4)
    (count,) = struct.unpack_from("<H", data, offset)
    tags: dict[int, tuple[float, ...] | bytes] = {}
    for index in range(count):
        entry = offset + 2 + 12 * index
        tag, kind, length = struct.unpack_from("<HHI", data, entry)
        if kind not in _TYPE_FORMATS:
            continue  # 우리가 쓰지 않는 태그
        fmt = _TYPE_FORMATS[kind]
        size = struct.calcsize("<" + fmt) * length
        start = entry + 8 if size <= 4 else struct.unpack_from("<I", data, entry + 8)[0]
        if kind == 2:
            tags[tag] = data[start : start + length]
        else:
            tags[tag] = struct.unpack_from(f"<{length}{fmt}", data, start)
    return tags


def _number(
    tags: dict[int, tuple[float, ...] | bytes], tag: int, default: float | None = None
) -> float:
    value = tags.get(tag)
    if isinstance(value, tuple) and value:
        return value[0]
    if default is None:
        raise ValueError(f"unsupported TIFF: tag {tag} is missing")
    return default


def _numbers(tags: dict[int, tuple[float, ...] | bytes], tag: int) -> tuple[float, ...]:
    value = tags.get(tag)
    if not isinstance(value, tuple):
        raise ValueError(f"unsupported TIFF: tag {tag} is missing")
    return value


def _placement(tags: dict[int, tuple[float, ...] | bytes]) -> tuple[float, float, float]:
    """왼쪽 위 모서리의 (x, y)와 픽셀 크기 (m)."""
    scale, tie = _numbers(tags, 33550), _numbers(tags, 33922)
    if scale[0] != scale[1] or tie[0] != 0.0 or tie[1] != 0.0:
        raise ValueError("unsupported TIFF: expected square pixels tied at the top-left corner")
    return tie[3], tie[4], scale[0]


def read_geotiff_bounds(path: Path) -> tuple[float, float, float, float]:
    """래스터가 덮는 범위 (x 최소, y 최소, x 최대, y 최대). 고도는 읽지 않아 큰 파일에도 가볍다."""
    with path.open("rb") as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as data:
        tags = _tags(data)
    left, top, pixel_size = _placement(tags)
    width, height = _number(tags, 256), _number(tags, 257)
    return (left, top - height * pixel_size, left + width * pixel_size, top)


def read_float_geotiff(path: Path) -> GeoRaster:
    data = path.read_bytes()
    tags = _tags(data)

    def number(tag: int, default: float | None = None) -> float:
        return _number(tags, tag, default)

    def numbers(tag: int) -> tuple[float, ...]:
        return _numbers(tags, tag)

    layout = {
        "bits per sample": (number(258), 32),
        "sample format": (number(339), 3),
        "samples per pixel": (number(277, 1), 1),
        "predictor": (number(317, 1), 3),
    }
    for name, (found, wanted) in layout.items():
        if found != wanted:
            raise ValueError(f"unsupported TIFF: {name} {found:g}, expected {wanted}")
    if number(259) not in _DEFLATE:
        raise ValueError(f"unsupported TIFF: compression {number(259):g}, expected deflate")

    width, height = int(number(256)), int(number(257))
    tile_w, tile_h = int(number(322)), int(number(323))
    heights = np.empty((height, width), dtype=np.float32)
    across = -(-width // tile_w)
    for index, (start, length) in enumerate(zip(numbers(324), numbers(325), strict=True)):
        packed = zlib.decompress(data[int(start) : int(start) + int(length)])
        rows = np.frombuffer(packed, dtype=np.uint8).reshape(tile_h, tile_w * 4)
        # 예측자 3: 각 행은 바이트 자리별(최상위 먼저)로 모은 뒤 앞 바이트와의 차이로 저장돼 있다
        rows = np.cumsum(rows, axis=1, dtype=np.uint8)
        planes = rows.reshape(tile_h, 4, tile_w)[:, ::-1, :]  # 최하위 바이트부터
        tile = np.ascontiguousarray(planes.transpose(0, 2, 1)).view("<f4")[..., 0]
        top, left = (index // across) * tile_h, (index % across) * tile_w
        part = heights[top : top + tile_h, left : left + tile_w]
        part[...] = tile[: part.shape[0], : part.shape[1]]

    nodata = tags.get(42113)
    if isinstance(nodata, bytes):
        heights[heights == np.float32(float(nodata.rstrip(b"\0 ").decode()))] = np.nan
    left, top, pixel_size = _placement(tags)
    return GeoRaster(heights, left_m=left, top_m=top, pixel_size_m=pixel_size)
