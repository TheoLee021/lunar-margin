from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from png_decode import decode_png

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import Roi
from lunar_margin.engine.candidates.horizon_table import (
    HorizonTable,
    HorizonTableSpec,
    build_horizon_table,
)
from lunar_margin.engine.dem import PolarDem
from lunar_margin.pipeline.overlay_tiles import build_overlay_tiles, build_wide_normal_tiles
from lunar_margin.pipeline.pds_label import PolarGridLabel


@pytest.fixture(scope="module")
def served(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("tiles")
    label = PolarGridLabel(101, 101, 100.0, 50.0, 50.0, 1737.4, 1737.4, -90.0)
    dem = PolarDem(np.zeros((101, 101), dtype=np.float32), label)
    spec = HorizonTableSpec(
        dem_id="flat",
        roi=Roi(min_lat_deg=-90.0, max_lat_deg=-89.95),
        spacing_m=500.0,
        azimuth_step_deg=1.0,
        max_range_m=2_000.0,
        observer_height_m=0.0,
    )
    build_horizon_table(root / "table", spec, dem)
    build_overlay_tiles(HorizonTable.open(root / "table"), dem, root / "tiles")
    return root


def client_for(root: Path) -> TestClient:
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=root)
    return TestClient(app)


@pytest.mark.parametrize("layer", ["horizon", "normal"])
def test_a_layer_serves_its_meta_and_its_tiles(served: Path, layer: str) -> None:
    client = client_for(served)

    meta = client.get(f"/tiles/{layer}/meta.json")
    tile = client.get(f"/tiles/{layer}/0/0/0.png")

    assert meta.status_code == 200
    level = meta.json()["levels"][0]
    assert meta.json()["layer"] == layer and level["pixel_size_m"] == 500.0
    assert tile.status_code == 200 and tile.headers["content-type"] == "image/png"
    assert "max-age" in tile.headers["cache-control"]
    width, height, _ = decode_png(tile.content)
    columns = 6 if layer == "horizon" else 1
    rows = 3 if layer == "horizon" else 1
    assert (width, height) == (columns * level["tile_px"], rows * level["tile_px"])


def test_the_normal_layer_serves_the_tiles_of_its_finer_levels(served: Path) -> None:
    client = client_for(served)

    levels = client.get("/tiles/normal/meta.json").json()["levels"]

    assert [level["z"] for level in levels] == [0, 1, 2]
    for level in levels[1:]:
        assert level["pixel_size_m"] < levels[level["z"] - 1]["pixel_size_m"]
        last = level["tiles_per_side"] - 1
        tile = client.get(f"/tiles/normal/{level['z']}/{last}/{last}.png")
        assert tile.status_code == 200 and tile.headers["content-type"] == "image/png"
        width, height, _ = decode_png(tile.content)
        assert (width, height) == (level["tile_px"], level["tile_px"])
        beyond = client.get(f"/tiles/normal/{level['z']}/{last + 1}/0.png")
        assert beyond.status_code == 404
    # 수평선 레이어에는 세밀 레벨이 없다
    assert client.get("/tiles/horizon/1/0/0.png").status_code == 404


def test_the_wide_layer_is_served_once_it_has_been_built(served: Path, tmp_path: Path) -> None:
    label = PolarGridLabel(101, 101, 100.0, 50.0, 50.0, 1737.4, 1737.4, -90.0)
    dem = PolarDem(np.zeros((101, 101), dtype=np.float32), label)
    build_wide_normal_tiles(dem, tmp_path / "tiles", radius_m=4_000.0, pixel_size_m=500.0)
    client = client_for(tmp_path)

    meta = client.get("/tiles/normal-wide/meta.json")
    tile = client.get("/tiles/normal-wide/0/0/0.png")

    assert meta.status_code == 200 and meta.json()["layer"] == "normal-wide"
    assert meta.headers["cache-control"] == "no-cache"
    assert tile.status_code == 200 and tile.headers["content-type"] == "image/png"
    assert decode_png(tile.content)[:2] == (17, 17)
    # 굽지 않은 곳(240 m DEM을 받지 않은 서버)에서는 다른 레이어는 그대로이고 이 레이어만 404다
    assert client_for(served).get("/tiles/normal-wide/meta.json").status_code == 404
    assert client_for(served).get("/tiles/normal/meta.json").status_code == 200


def test_meta_is_revalidated_on_every_load_while_tiles_may_be_cached(served: Path) -> None:
    # meta는 어떤 레벨과 타일이 있는지 알려 준다. 타일을 다시 구운 뒤에도 브라우저가 예전 meta를
    # 쓰면 새 레벨(예: 20 m, 5 m)을 아예 요청하지 않는다
    client = client_for(served)

    meta = client.get("/tiles/normal/meta.json")
    tile = client.get("/tiles/normal/0/0/0.png")

    assert meta.headers["cache-control"] == "no-cache"
    assert "max-age" in tile.headers["cache-control"]


@pytest.mark.parametrize(
    "path",
    [
        "/tiles/albedo/meta.json",  # 없는 레이어
        "/tiles/horizon/0/1/0.png",  # 레벨 범위 밖 타일
        "/tiles/horizon/3/0/0.png",  # 없는 레벨
        "/tiles/..%2Fhorizon/0/0/0.png",  # 경로 조작
    ],
)
def test_unknown_layers_and_tiles_are_not_found(served: Path, path: str) -> None:
    assert client_for(served).get(path).status_code == 404


def test_a_layer_that_was_never_built_is_not_found(tmp_path: Path) -> None:
    assert client_for(tmp_path).get("/tiles/horizon/meta.json").status_code == 404
