import numpy as np

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.viewshed import horizontal_rays, local_viewshed
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
