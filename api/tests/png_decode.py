"""테스트용 최소 PNG 디코더: 우리 인코더가 쓰는 8비트 RGBA, 필터 0만 지원한다."""

import struct
import zlib

import numpy as np
from numpy.typing import NDArray


def decode_png(data: bytes) -> tuple[int, int, NDArray[np.uint8]]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos = 8
    chunks: dict[bytes, bytes] = {}
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        (crc,) = struct.unpack(">I", data[pos + 8 + length : pos + 12 + length])
        assert crc == zlib.crc32(kind + body)
        chunks[kind] = chunks.get(kind, b"") + body
        pos += 12 + length
    width, height, depth, color = struct.unpack(">IIBB", chunks[b"IHDR"][:10])
    assert (depth, color) == (8, 6)
    raw = zlib.decompress(chunks[b"IDAT"])
    rows = np.frombuffer(raw, dtype=np.uint8).reshape(height, 1 + width * 4)
    assert np.all(rows[:, 0] == 0)
    return width, height, rows[:, 1:].reshape(height, width, 4)
