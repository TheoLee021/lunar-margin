"""PDS3 `.lbl` 라벨에서 극 입체투영 격자 정보를 읽는다."""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class PolarGridLabel:
    lines: int
    samples: int
    map_scale_m: float
    line_offset: float
    sample_offset: float
    radius_km: float
    height_offset_km: float
    center_lat_deg: float


def _value(text: str, key: str) -> str:
    # 줄 맨 앞의 정확한 키만 매칭한다 (OFFSET이 LINE_PROJECTION_OFFSET에 걸리지 않도록)
    match = re.search(rf"^[ \t]*{re.escape(key)}[ \t]*=[ \t]*(.+?)[ \t]*$", text, re.MULTILINE)
    if match is None:
        raise ValueError(f"PDS label is missing required key {key}")
    return match.group(1)


def _number(text: str, key: str) -> float:
    raw = _value(text, key)
    match = re.match(r"[-+]?\d+(?:\.\d+)?", raw)
    if match is None:
        raise ValueError(f"PDS label key {key} is not numeric: {raw!r}")
    return float(match.group(0))


def parse_label(text: str) -> PolarGridLabel:
    if _value(text, "MAP_PROJECTION_TYPE").strip('"') != "POLAR STEREOGRAPHIC":
        raise ValueError("only POLAR STEREOGRAPHIC labels are supported")
    if _value(text, "SAMPLE_TYPE") != "PC_REAL" or int(_number(text, "SAMPLE_BITS")) != 32:
        raise ValueError("only 32-bit PC_REAL (little-endian float32) images are supported")
    if _number(text, "SCALING_FACTOR") != 1.0:
        raise ValueError("SCALING_FACTOR other than 1 is not supported")
    return PolarGridLabel(
        lines=int(_number(text, "LINES")),
        samples=int(_number(text, "LINE_SAMPLES")),
        map_scale_m=_number(text, "MAP_SCALE"),
        line_offset=_number(text, "LINE_PROJECTION_OFFSET"),
        sample_offset=_number(text, "SAMPLE_PROJECTION_OFFSET"),
        radius_km=_number(text, "A_AXIS_RADIUS"),
        height_offset_km=_number(text, "OFFSET"),
        center_lat_deg=_number(text, "CENTER_LATITUDE"),
    )
