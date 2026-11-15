import numpy as np

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.viewshed import local_viewshed
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
