import numpy as np

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.viewshed import grid_sightlines, horizontal_rays, local_viewshed
from lunar_margin.pipeline.pds_label import PolarGridLabel


def test_ridge_is_visible_and_hides_surface_to_its_east() -> None:
    terrain = np.zeros((131, 131), dtype=np.float32)
    terrain[:, 70] = 0.1  # 100 m ridge, 400 m east of the observer
    label = PolarGridLabel(131, 131, 80, 65, 65, 1737.4, 0, -90)
    mask = local_viewshed(PolarDem(terrain, label), -90, 0)
    assert mask[62, 67] == 2
    assert mask[62, 72] == 1
    assert mask[62, 52] == 2
    assert mask[0, 0] == 0


def test_horizontal_ray_stops_on_near_face_of_first_ridge() -> None:
    terrain = np.zeros((131, 131), dtype=np.float32)
    terrain[:, [70, 85]] = 0.1
    label = PolarGridLabel(131, 131, 80, 65, 65, 1737.4, 0, -90)
    _, rays = horizontal_rays(PolarDem(terrain, label), -90, 0)
    distance, hit = rays[6]  # East. Ridge rises from 0 to 100 m between 320 and 400 m.
    assert hit and 321 < distance < 323
    assert rays[18] == (5000, False)


def test_grid_target_behind_ridge_has_first_hit_and_near_target_is_visible() -> None:
    terrain = np.zeros((131, 131), dtype=np.float32)
    terrain[:, 80] = 0.1  # 1200 m east; base starts at 1120 m
    label = PolarGridLabel(131, 131, 80, 65, 65, 1737.4, 0, -90)
    dem = PolarDem(terrain, label)
    targets = grid_sightlines(dem, -90, 0)
    east = {
        round(dem.lonlat_to_xy(lat, lon)[0]): hit
        for (lon, lat, _), hit in targets
        if abs(lon - 90) < 1e-6
    }
    assert east[800] is None
    hit = east[1600]
    assert hit is not None
    x, _ = dem.lonlat_to_xy(hit[1], hit[0])
    assert 1120 < x < 1130


def test_narrow_crest_between_regular_probes_blocks_distant_target() -> None:
    terrain = np.zeros((131, 131), dtype=np.float32)
    terrain[:, 70] = 0.100  # 100 m high, 400 m east
    terrain[:, 125] = 1.178  # target 4800 m east, almost tangent to crest
    label = PolarGridLabel(131, 131, 80, 65, 65, 1737.4, 0, -90)
    dem = PolarDem(terrain, label)
    assert local_viewshed(dem, -90, 0)[62, 122] == 1
    targets = grid_sightlines(dem, -90, 0)
    for (lon, lat, _), hit in targets:
        x, y = dem.lonlat_to_xy(lat, lon)
        if abs(x - 4800) < 0.01 and abs(y) < 0.01:
            assert hit is not None
            assert 398 < dem.lonlat_to_xy(hit[1], hit[0])[0] < 400
            return
    raise AssertionError("Missing eastern grid target")
