"""Real LOLA integration for the preliminary powered-descent terrain sampler.

This checks wiring to an actual NASA PDS DEM. It does not verify
the reference trajectory against a flown lunar landing.
"""

from pathlib import Path

import numpy as np
import pytest

from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.descent_reference import (
    R_M,
    Lander,
    evaluate_reference,
    pdi_from_target,
)
from lunar_margin.pipeline.sources import DEM_SOURCES


def test_reference_samples_real_lola_terrain(data_dir: Path) -> None:
    img_src, lbl_src = DEM_SOURCES["80s_80m"]
    dem = PolarDem.from_files(
        data_dir / "dem" / img_src.filename,
        data_dir / "dem" / lbl_src.filename,
    )
    lat, lon = -89.0, 30.0
    ground_m = dem.height_at(lat, lon)
    pdi = pdi_from_target(lat, lon)
    result = evaluate_reference(dem, pdi, lat, lon, Lander(), duration_s=480)

    # Confirm this is a geographical DEM lookup rather than zero-height stub.
    assert dem.label.map_scale_m == pytest.approx(80)
    assert result.samples
    assert result.samples[-1].altitude_agl_m == pytest.approx(0, abs=0.05)
    assert result.samples[0].altitude_agl_m is not None
    final_radius = float(np.linalg.norm(np.array(result.samples[-1].moon_me_xyz_m)))
    assert final_radius - R_M == pytest.approx(ground_m, abs=0.1)
    # No requirement that a specific real location be "safe" or "landable".
    assert result.status in {
        "REFERENCE_FEASIBLE",
        "TERRAIN_COLLISION",
        "TERRAIN_UNKNOWN",
        "ENGINE_LIMIT",
        "FUEL_LIMIT",
    }
