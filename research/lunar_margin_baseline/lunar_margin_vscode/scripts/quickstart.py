#!/usr/bin/env python3
"""First-run smoke test: SPICE Sun/Earth geometry with a flat horizon.

This deliberately avoids remote DEM access. Once this works, run the full
terrain-aware trade runner.
"""
from pathlib import Path
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lunar_margin.config import SITES
from lunar_margin.geometry import load_kernels, target_geometry
from lunar_margin.terrain import HorizonProfile
from lunar_margin.visibility import visibility_from_horizon

KERNELS = [
    ROOT / "kernels" / "naif0012.tls",
    ROOT / "kernels" / "de440s.bsp",
    ROOT / "kernels" / "pck00011.tpc",
    ROOT / "kernels" / "moon_pa_de421_1900-2050.bpc",
    ROOT / "kernels" / "moon_080317.tf",
]

UTC = "2028-11-15T12:00:00"


def main():
    missing = [str(p) for p in KERNELS if not p.exists()]
    if missing:
        raise FileNotFoundError(
            "Missing SPICE kernels. Run first:\n  python scripts/download_kernels.py\n"
            + "\n".join(missing)
        )

    load_kernels(KERNELS)
    flat = HorizonProfile(
        az_deg=np.arange(0.0, 360.0, 1.0),
        horizon_el_deg=np.zeros(360),
    )

    print(f"Lunar Margin SPICE smoke test @ {UTC}\n")
    for name, site in SITES.items():
        lat = site["lat_deg"]
        lon = site["lon_deg"]
        sun = target_geometry(UTC, lat, lon, "SUN")
        earth = target_geometry(UTC, lat, lon, "EARTH")
        sv = visibility_from_horizon(sun["az_deg"], sun["el_deg"], flat)
        ev = visibility_from_horizon(earth["az_deg"], earth["el_deg"], flat)

        print(name)
        print(f"  site  lat={lat:.3f} deg, lon={lon:.3f} deg E")
        print(f"  Sun   az={sun['az_deg']:.2f} deg, el={sun['el_deg']:.2f} deg, visible={sv['visible']}")
        print(f"  Earth az={earth['az_deg']:.2f} deg, el={earth['el_deg']:.2f} deg, range={earth['range_km']:.0f} km, visible={ev['visible']}")
        print()

    print("PASS: SPICE geometry is running. Next step: terrain-aware horizon.")


if __name__ == "__main__":
    main()
