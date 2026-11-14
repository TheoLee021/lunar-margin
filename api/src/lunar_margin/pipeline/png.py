"""외부 라이브러리 없이 8비트 RGBA PNG를 만드는 최소 인코더 (지도 레이어용)."""

import struct
import zlib

import numpy as np
from numpy.typing import NDArray


def _chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def encode_png(rgba: NDArray[np.uint8]) -> bytes:
    if rgba.ndim != 3 or rgba.shape[2] != 4 or rgba.dtype != np.uint8:
        raise ValueError("expected a uint8 array of shape (height, width, 4)")
    height, width, _ = rgba.shape
    filtered = np.zeros((height, 1 + width * 4), dtype=np.uint8)  # 각 행 앞에 필터 종류 0
    filtered[:, 1:] = rgba.reshape(height, width * 4)
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(filtered.tobytes(), 6))
        + _chunk(b"IEND", b"")
    )
