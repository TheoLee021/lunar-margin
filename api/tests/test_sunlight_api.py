"""GET /sunlight/sun-direction, /sunlight/south-pole.png,
/sunlight/south-pole/{level}/{tile_x}/{tile_y}.png: 한 시각의 태양 방향과, 태양 방향 하나의
햇빛 지도와 그 세밀한 창 (계약: docs/api.md)."""

import math
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
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
from lunar_margin.app.sunlight import (
    DetailLevel,
    DetailRegion,
    detail_levels,
    get_renderer,
    get_sun_finder,
    make_renderer,
    sunlight_grid,
)
from lunar_margin.engine.dem import PolarDem, RasterDem
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


# 세밀 레벨: 25 m 격자(극에서 +-5 km), 32px 타일. 지역 DEM 하나가 타일 x 6~9, y 2~5를 덮는다:
# x -200~3000 m, y 200~3400 m. 창은 4x4 타일(128px)이라 (6, 2)에서 시작하면 그 지역과 같다
LEVEL = DetailLevel(
    grid=SunlightGrid(pixel_size_m=25.0, center_px=200), tile_px=32, tile_ranges=((6, 2, 9, 5),)
)
SUN_5_DEG = {"x": math.cos(math.radians(5.0)), "y": 0.0, "z": -math.sin(math.radians(5.0))}


def ridge_region() -> RasterDem:
    """넓은 DEM에는 없는 높이 100 m 둑: y 2400~2500 m에 동서로 놓여 있다."""
    heights = np.zeros((128, 128), dtype=np.float32)
    heights[36:40, :] = 100.0  # 행 r의 중심은 y = 3400 - (r + 0.5) * 25
    return RasterDem(heights, left_m=-200.0, top_m=3400.0, pixel_size_m=25.0)


@pytest.fixture(scope="module")
def detailed() -> TestClient:
    label = PolarGridLabel(401, 401, 100.0, 200.0, 200.0, 1737.4, 1737.4, -90.0)
    dem = PolarDem(np.zeros((401, 401), dtype=np.float32), label)
    app = create_app(Settings())
    renderer = make_renderer(
        dem,
        GRID,
        reach_m=5_000.0,
        levels={3: LEVEL},
        regions=[DetailRegion(bounds_m=(-200.0, 200.0, 3000.0, 3400.0), load=ridge_region)],
    )
    app.dependency_overrides[get_renderer] = lambda: renderer
    return TestClient(app)


def test_a_window_is_a_grey_png_of_four_by_four_tiles_with_the_detail_dems_shadows(
    detailed: TestClient,
) -> None:
    # 태양은 경도 0° 쪽(이미지 위쪽) 고도 5°: 둑의 그림자는 뒤쪽 끝(y = 2400 m)에서
    # 100 / tan 5° = 1143 m 이어진다
    response = detailed.get("/sunlight/south-pole/3/6/2.png", params=SUN_5_DEG)

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "max-age" in response.headers["cache-control"]
    width, height, image = decode_png(response.content)
    assert (width, height) == (128, 128)
    assert np.array_equal(image[..., 0], image[..., 1])
    assert np.array_equal(image[..., 0], image[..., 2])
    assert np.all(image[..., 3] == 255)

    def at(y_m: float) -> int:
        # 창의 첫 행은 레벨 이미지의 행 64: y = (200 - 64) * 25 = 3400 m
        return int(image[round((3400.0 - y_m) / 25.0), 64, 0])

    assert at(2_000.0) == 0  # 둑 뒤 400 m: 그림자 안
    assert at(800.0) == 255  # 둑 뒤 1600 m: 그림자 밖
    assert at(3_000.0) == 255  # 둑 앞(태양 쪽)


def test_the_whole_map_does_not_use_the_detail_dems(detailed: TestClient) -> None:
    # 전체 지도(100 m 격자, 101px)는 넓은 DEM만으로 계산한다: 둑이 없으니 그림자도 없다
    _, _, image = decode_png(detailed.get("/sunlight/south-pole.png", params=SUN_5_DEG).content)

    assert image[50 - 20, 50 + 10, 0] == 255  # (x, y) = (1000 m, 2000 m)


@pytest.mark.parametrize(
    "path",
    [
        "/sunlight/south-pole/3/0/0.png",  # 타일 x 0~3, y 0~3: 지역 DEM이 덮는 타일이 없다
        "/sunlight/south-pole/3/10/2.png",
        "/sunlight/south-pole/2/6/2.png",  # 창으로 나누지 않는 레벨
        "/sunlight/south-pole/9/6/2.png",
    ],
)
def test_a_window_without_detail_tiles_is_404(detailed: TestClient, path: str) -> None:
    assert detailed.get(path, params=SUN_5_DEG).status_code == 404


def test_a_window_only_partly_over_detail_tiles_is_still_served(detailed: TestClient) -> None:
    # 타일 x 3~6, y -1~2: 지역의 왼쪽 위 타일 (6, 2) 하나만 걸친다. 창은 레벨 밖으로 나가도 된다
    response = detailed.get("/sunlight/south-pole/3/3/-1.png", params=SUN_5_DEG)

    assert response.status_code == 200
    assert decode_png(response.content)[:2] == (128, 128)


def test_a_window_needs_a_usable_direction(detailed: TestClient) -> None:
    response = detailed.get("/sunlight/south-pole/3/6/2.png", params={"x": 0.0, "y": 0.0, "z": -1})

    assert response.status_code == 422


def test_a_window_without_data_is_503_not_500(tmp_path: Path) -> None:
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)

    response = TestClient(app).get("/sunlight/south-pole/3/6/2.png", params=SUN_5_DEG)

    assert response.status_code == 503


def test_windows_are_offered_on_the_sparse_levels() -> None:
    levels = [
        {"z": 0, "pixel_size_m": 500.0, "center_px": 303, "tile_px": 607},
        {"z": 2, "pixel_size_m": 80.0, "center_px": 1894, "tile_px": 256},
        {
            "z": 4,
            "pixel_size_m": 5.0,
            "center_px": 30300,
            "tile_px": 256,
            "tile_ranges": [[98, 124, 113, 139], [72, 92, 88, 108]],
        },
    ]

    assert detail_levels(levels) == {
        4: DetailLevel(
            grid=SunlightGrid(pixel_size_m=5.0, center_px=30300),
            tile_px=256,
            tile_ranges=((98, 124, 113, 139), (72, 92, 88, 108)),
        )
    }


def test_a_window_waits_in_the_same_queue_as_the_whole_map() -> None:
    dem = GatedDem()
    app = create_app(Settings())
    renderer = make_renderer(dem, GRID, reach_m=5_000.0, max_waiting=0, levels={3: LEVEL})
    app.dependency_overrides[get_renderer] = lambda: renderer
    client = TestClient(app)
    with ThreadPoolExecutor(max_workers=1) as pool:
        whole = pool.submit(get_map, client, 1.0, 0.0)
        assert dem.started.wait(timeout=20)  # 전체 지도를 계산 중이다

        busy = client.get("/sunlight/south-pole/3/6/2.png", params=SUN_5_DEG)

        assert busy.status_code == 429
        assert int(busy.headers["retry-after"]) > 0
        dem.gate.set()
        assert whole.result(timeout=20) == 200
    assert client.get("/sunlight/south-pole/3/6/2.png", params=SUN_5_DEG).status_code == 200


def sun_client(asked: list[datetime]) -> TestClient:
    def finder(moment: datetime) -> tuple[float, float, float]:
        asked.append(moment)
        return (0.6, -0.8, 0.0000004)

    app = create_app(Settings())
    app.dependency_overrides[get_sun_finder] = lambda: finder
    return TestClient(app)


def test_the_sun_direction_of_a_moment_is_a_moon_me_vector() -> None:
    asked: list[datetime] = []

    # 서울 시각 09:00 = 00:00 UTC
    response = sun_client(asked).get(
        "/sunlight/sun-direction", params={"time": "2027-01-10T09:00:00+09:00"}
    )

    assert response.status_code == 200
    assert response.json() == {"time": "2027-01-10T00:00:00Z", "x": 0.6, "y": -0.8, "z": 0.0}
    assert "max-age" in response.headers["cache-control"]
    assert [moment.astimezone(UTC) for moment in asked] == [datetime(2027, 1, 10, tzinfo=UTC)]


@pytest.mark.parametrize(
    "params",
    [
        {},  # 시각 누락
        {"time": "2027-01-10T00:00:00"},  # 타임존 없음
        {"time": "soon"},
        {"time": "2027-01-10T00:00:00Z", "lat": "-89.7"},  # 모르는 파라미터
    ],
)
def test_an_unusable_moment_is_422(params: dict[str, str]) -> None:
    assert sun_client([]).get("/sunlight/sun-direction", params=params).status_code == 422


def test_the_sun_direction_without_spice_kernels_is_503_not_500(tmp_path: Path) -> None:
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)

    response = TestClient(app).get(
        "/sunlight/sun-direction", params={"time": "2027-01-10T00:00:00Z"}
    )

    assert response.status_code == 503
