"""SPICE로 달 표면 관측점에서 본 태양·지구의 방위각/고도각.

프레임은 MOON_ME(달 평균 지구/자전축). LOLA DEM도 같은 프레임이므로 좌표가 일치한다.
관측점은 반경 1737.4 km 구 위 + 안테나 높이이며, 지형 고도는 태양·지구 방향에 영향이 없어 무시한다.
"""

import math
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import numpy as np
import spiceypy
from numpy.typing import NDArray

MOON_RADIUS_M = 1_737_400.0
_KERNELS = (
    "naif0012.tls",
    "de440s.bsp",
    "pck00011.tpc",
    "moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf",
)
_loaded: set[Path] = set()
# CSPICE는 스레드 안전하지 않다(전역 상태 사용). 동시에 부르면 오류가 나거나 프로세스가 비정상
# 종료하므로, SPICE를 부르는 모든 곳을 이 락으로 감싼다. FastAPI는 동기 엔드포인트를
# 스레드풀에서 동시에 실행한다.
_SPICE_LOCK = threading.RLock()


def load_kernels(spice_dir: Path) -> None:
    """필요한 커널을 한 번만 로드한다. 없는 파일이 있으면 FileNotFoundError."""
    with _SPICE_LOCK:
        directory = spice_dir.resolve()
        if directory in _loaded:
            return
        for name in _KERNELS:
            path = directory / name
            if not path.exists():
                raise FileNotFoundError(f"missing SPICE kernel {path}; run the fetch pipeline")
        for name in _KERNELS:
            spiceypy.furnsh(str(directory / name))
        _loaded.add(directory)


def utc_range(start: datetime, end: datetime, step_minutes: int) -> NDArray[np.float64]:
    """[start, end) 구간을 step_minutes 간격으로 나눈 ET(초). 윤초는 고려하지 않는다."""
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("start and end must include a timezone")
    if end <= start:
        raise ValueError("end must be after start")
    if step_minutes <= 0:
        raise ValueError("step_minutes must be positive")
    start_utc = start.astimezone(UTC).replace(tzinfo=None)
    with _SPICE_LOCK:
        et0 = float(spiceypy.str2et(start_utc.strftime("%Y-%m-%dT%H:%M:%S.%f")))
    step_s = step_minutes * 60.0
    count = math.ceil((end - start).total_seconds() / step_s)
    return et0 + step_s * np.arange(count, dtype=np.float64)


def body_vectors(body: Literal["SUN", "EARTH"], et: NDArray[np.float64]) -> NDArray[np.float64]:
    """달 중심에서 본 천체의 위치 벡터(km, MOON_ME 프레임, LT+S 보정). 모양 (N, 3).

    지점과 무관하므로 한 번만 계산해 여러 지점에 재사용할 수 있다.
    """
    with _SPICE_LOCK:
        positions, _ = spiceypy.spkpos(body, et.tolist(), "MOON_ME", "LT+S", "MOON")
    return np.asarray(positions, dtype=np.float64)


def sun_direction(moment: datetime) -> tuple[float, float, float]:
    """달에서 태양을 향하는 단위 벡터 (MOON_ME 프레임, LT+S 보정). 달 위 어느 지점에서나 같다."""
    if moment.tzinfo is None:
        raise ValueError("moment must include a timezone")
    utc = moment.astimezone(UTC).replace(tzinfo=None)
    with _SPICE_LOCK:
        et = float(spiceypy.str2et(utc.strftime("%Y-%m-%dT%H:%M:%S.%f")))
    x, y, z = body_vectors("SUN", np.array([et]))[0]
    norm = math.sqrt(x * x + y * y + z * z)
    return (float(x / norm), float(y / norm), float(z / norm))


def topocentric_azel(
    vectors_km: NDArray[np.float64],
    lat_deg: float,
    lon_deg: float,
    observer_height_m: float = 0.0,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """달 중심 벡터를 한 관측점의 (방위각°, 고각°)으로 바꾼다. 방위각 0°=북, 시계방향."""
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    up = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    east = np.array([-math.sin(lon), math.cos(lon), 0.0])
    north = np.cross(up, east)  # up 과 east 의 외적이 north
    observer_km = up * (MOON_RADIUS_M + observer_height_m) / 1000.0

    local = vectors_km - observer_km  # (N, 3)
    e, n, u = local @ east, local @ north, local @ up
    elevation = np.degrees(np.arctan2(u, np.hypot(e, n)))
    azimuth = np.degrees(np.arctan2(e, n)) % 360.0
    return azimuth, elevation


def body_azel(
    body: Literal["SUN", "EARTH"],
    lat_deg: float,
    lon_deg: float,
    et: NDArray[np.float64],
    observer_height_m: float = 0.0,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """(방위각°, 고각°). 방위각 0°=북, 시계방향. 빛 시간·광행차 보정(LT+S)."""
    return topocentric_azel(body_vectors(body, et), lat_deg, lon_deg, observer_height_m)


def moon_states(start: datetime, seconds: NDArray[np.float64]) -> NDArray[np.float64]:
    """Geometric Earth-centered J2000 Moon states, km and km/s (no light-time correction)."""
    if start.tzinfo is None:
        raise ValueError("start must include a timezone")
    utc = start.astimezone(UTC).replace(tzinfo=None)
    with _SPICE_LOCK:
        et = float(spiceypy.str2et(utc.strftime("%Y-%m-%dT%H:%M:%S.%f")))
        states, _ = spiceypy.spkezr("MOON", (et + seconds).tolist(), "J2000", "NONE", "EARTH")
    return np.asarray(states, dtype=np.float64)
