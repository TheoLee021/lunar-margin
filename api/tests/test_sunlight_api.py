"""GET /sunlight/south-pole.png: 태양 방향 하나의 햇빛 지도 (계약: docs/api.md)."""

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from png_decode import decode_png

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.app.sunlight import get_renderer, make_renderer, sunlight_grid
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.sunlight import SunlightGrid
from lunar_margin.pipeline.pds_label import PolarGridLabel

GRID = SunlightGrid(pixel_size_m=100.0, center_px=50)  # 극에서 +-5 km


@pytest.fixture(scope="module")
def client() -> TestClient:
    label = PolarGridLabel(401, 401, 100.0, 200.0, 200.0, 1737.4, 1737.4, -90.0)
    dem = PolarDem(np.zeros((401, 401), dtype=np.float32), label)
    app = create_app(Settings())
    app.dependency_overrides[get_renderer] = lambda: make_renderer(dem, GRID, reach_m=5_000.0)
    return TestClient(app)


def test_the_map_is_a_grey_png_of_the_grid_brighter_towards_the_sun(client: TestClient) -> None:
    # 태양 중심이 극의 지평선에 걸려 있고, 경도 0° 쪽(+X, 이미지 위쪽)에서 비춘다
    response = client.get("/sunlight/south-pole.png", params={"x": 1.0, "y": 0.0, "z": 0.0})

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "max-age" in response.headers["cache-control"]
    width, height, image = decode_png(response.content)
    assert (width, height) == (GRID.size_px, GRID.size_px)
    assert np.array_equal(image[..., 0], image[..., 1])
    assert np.array_equal(image[..., 0], image[..., 2])
    assert np.all(image[..., 3] == 255)
    # 매끈한 구: 태양 쪽 5 km에서는 원반의 87%, 반대쪽 5 km에서는 13%가 보인다
    assert image[0, 50, 0] == pytest.approx(0.87 * 255, abs=16)
    assert image[100, 50, 0] == pytest.approx(0.13 * 255, abs=16)


def test_the_direction_does_not_need_to_be_a_unit_vector(client: TestClient) -> None:
    unit = client.get("/sunlight/south-pole.png", params={"x": 0.6, "y": 0.8, "z": 0.0})
    scaled = client.get("/sunlight/south-pole.png", params={"x": 3.0, "y": 4.0, "z": 0.0})

    assert unit.status_code == 200 and scaled.content == unit.content


@pytest.mark.parametrize(
    "params",
    [
        {"x": 0.0, "y": 0.0, "z": 0.0},  # 방향이 없다
        {"x": 0.0, "y": 0.0, "z": -1.0},  # 극의 천정: 햇빛이 오는 방위가 없다
        {"x": 1.0, "y": 0.0},  # 성분 누락
        {"x": "nan", "y": 0.0, "z": 0.0},
        {"x": 1.0, "y": 0.0, "z": 0.0, "time": "2027-01-10"},  # 모르는 파라미터
    ],
)
def test_an_unusable_direction_is_422(client: TestClient, params: dict[str, float | str]) -> None:
    assert client.get("/sunlight/south-pole.png", params=params).status_code == 422


def test_missing_data_is_503_not_500(tmp_path: Path) -> None:
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)

    response = TestClient(app).get(
        "/sunlight/south-pole.png", params={"x": 1.0, "y": 0.0, "z": 0.0}
    )

    assert response.status_code == 503


def test_the_grid_is_the_finest_level_that_covers_the_whole_area() -> None:
    # 희소 레벨(tile_ranges가 있는 5 m 등)은 지역 몇 곳만 덮는다. 그 격자로 전체를 계산하면
    # 6만 x 6만 픽셀이 된다
    levels = [
        {"z": 0, "pixel_size_m": 500.0, "center_px": 303},
        {"z": 1, "pixel_size_m": 160.0, "center_px": 947},
        {"z": 2, "pixel_size_m": 80.0, "center_px": 1894},
        {"z": 3, "pixel_size_m": 20.0, "center_px": 7575, "tile_ranges": [[24, 31, 28, 35]]},
        {"z": 4, "pixel_size_m": 5.0, "center_px": 30300, "tile_ranges": [[98, 124, 113, 139]]},
    ]

    assert sunlight_grid(levels) == SunlightGrid(pixel_size_m=80.0, center_px=1894)
    assert sunlight_grid(levels[:1]) == SunlightGrid(pixel_size_m=500.0, center_px=303)


def test_the_grid_never_grows_beyond_what_one_request_can_compute() -> None:
    # 영역 전체를 덮는 20 m 레벨이 생겨도(15151 x 15151, 계산에 10 GB 이상) 그 격자를 고르지 않는다
    levels = [
        {"z": 0, "pixel_size_m": 500.0, "center_px": 303},
        {"z": 1, "pixel_size_m": 80.0, "center_px": 1894},
        {"z": 2, "pixel_size_m": 20.0, "center_px": 7575},
    ]

    assert sunlight_grid(levels) == SunlightGrid(pixel_size_m=80.0, center_px=1894)


class GatedDem(PolarDem):
    """높이를 처음 읽을 때 문이 열리기를 기다리는 DEM: 계산이 진행 중인 상태를 만든다."""

    def __init__(self) -> None:
        label = PolarGridLabel(401, 401, 100.0, 200.0, 200.0, 1737.4, 1737.4, -90.0)
        super().__init__(np.zeros((401, 401), dtype=np.float32), label)
        self.started = Event()
        self.gate = Event()

    def sample_height_m(
        self, x_m: NDArray[np.float64], y_m: NDArray[np.float64]
    ) -> NDArray[np.float64]:
        self.started.set()
        assert self.gate.wait(timeout=20), "the test never opened the gate"
        return super().sample_height_m(x_m, y_m)


@pytest.fixture
def gated() -> Iterator[tuple[TestClient, GatedDem]]:
    dem = GatedDem()
    app = create_app(Settings())
    renderer = make_renderer(dem, GRID, reach_m=5_000.0, max_waiting=0)
    app.dependency_overrides[get_renderer] = lambda: renderer
    yield TestClient(app), dem
    dem.gate.set()


def get_map(client: TestClient, x: float, y: float) -> int:
    return client.get("/sunlight/south-pole.png", params={"x": x, "y": y, "z": 0.0}).status_code


def test_when_too_many_maps_are_already_waiting_a_new_one_is_turned_away(
    gated: tuple[TestClient, GatedDem],
) -> None:
    client, dem = gated
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(get_map, client, 1.0, 0.0)
        assert dem.started.wait(timeout=20)  # 첫 요청이 계산 중이다

        busy = client.get("/sunlight/south-pole.png", params={"x": 0.0, "y": 1.0, "z": 0.0})

        assert busy.status_code == 429
        assert int(busy.headers["retry-after"]) > 0
        dem.gate.set()
        assert first.result(timeout=20) == 200
    # 계산이 끝나면 다시 받는다
    assert get_map(client, 0.0, 1.0) == 200


def test_a_remembered_map_is_served_even_while_another_is_being_computed(
    gated: tuple[TestClient, GatedDem],
) -> None:
    client, dem = gated
    dem.gate.set()
    assert get_map(client, 1.0, 0.0) == 200  # 기억해 둘 지도
    dem.gate.clear()
    dem.started.clear()
    with ThreadPoolExecutor(max_workers=1) as pool:
        other = pool.submit(get_map, client, 0.0, 1.0)
        assert dem.started.wait(timeout=20)

        assert get_map(client, 1.0, 0.0) == 200

        dem.gate.set()
        assert other.result(timeout=20) == 200
