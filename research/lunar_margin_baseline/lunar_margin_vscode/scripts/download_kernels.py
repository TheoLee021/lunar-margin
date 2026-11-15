#!/usr/bin/env python3
"""Download the minimal NAIF kernels used by the VS Code quickstart."""
from pathlib import Path
from urllib.request import urlretrieve

KERNELS = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "de440s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp",
    "pck00011.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc",
    # moon_080317.tf defines MOON_ME using the DE421 lunar orientation frame.
    "moon_pa_de421_1900-2050.bpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc",
    "moon_080317.tf": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf",
}


def main():
    root = Path(__file__).resolve().parents[1]
    out = root / "kernels"
    out.mkdir(exist_ok=True)

    for name, url in KERNELS.items():
        target = out / name
        if target.exists() and target.stat().st_size > 0:
            print(f"OK   {name} already exists")
            continue
        print(f"GET  {name}")
        urlretrieve(url, target)
        print(f"DONE {name} ({target.stat().st_size/1e6:.1f} MB)")

    print("\nKernel download complete.")


if __name__ == "__main__":
    main()
