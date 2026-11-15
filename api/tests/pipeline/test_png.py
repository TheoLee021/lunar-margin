import struct
import zlib

import numpy as np

from lunar_margin.pipeline.png import encode_png


def decode(data: bytes) -> tuple[int, int, np.ndarray]:
    """테스트용 최소 디코더: 우리가 쓰는 8비트 RGBA, 필터 0만 지원한다."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos = 8
    chunks: dict[bytes, bytes] = {}
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        (crc,) = struct.unpack(">I", data[pos + 8 + length : pos + 12 + length])
        assert crc == zlib.crc32(kind + body)
        chunks.setdefault(kind, b"")
        chunks[kind] += body
        pos += 12 + length
    width, height, depth, color = struct.unpack(">IIBB", chunks[b"IHDR"][:10])
    assert (depth, color) == (8, 6)
    raw = zlib.decompress(chunks[b"IDAT"])
    rows = np.frombuffer(raw, dtype=np.uint8).reshape(height, 1 + width * 4)
    assert np.all(rows[:, 0] == 0)
    return width, height, rows[:, 1:].reshape(height, width, 4)


def test_round_trip_preserves_size_and_pixels() -> None:
    rng = np.random.default_rng(0)
    image = rng.integers(0, 256, size=(7, 5, 4), dtype=np.uint8)

    width, height, decoded = decode(encode_png(image))

    assert (width, height) == (5, 7)
    assert np.array_equal(decoded, image)


def test_transparent_pixels_survive() -> None:
    image = np.zeros((2, 2, 4), dtype=np.uint8)
    image[0, 0] = (255, 0, 0, 255)

    _, _, decoded = decode(encode_png(image))

    assert decoded[0, 0].tolist() == [255, 0, 0, 255]
    assert decoded[1, 1, 3] == 0


def test_rejects_wrong_shape_or_dtype() -> None:
    import pytest

    with pytest.raises(ValueError):
        encode_png(np.zeros((2, 2, 3), dtype=np.uint8))
    with pytest.raises(ValueError):
        encode_png(np.zeros((2, 2, 4), dtype=np.float64))  # pyright: ignore[reportArgumentType]
