#!/usr/bin/env python3
"""Example 3-site Sun/Earth trade runner.

Requires SPICE kernels and a working DEM. Edit KERNELS and times below.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd

from lunar_margin.config import SITES, DEFAULT_DEM_URL
from lunar_margin.geometry import load_kernels
from lunar_margin.terrain import TerrainModel
from lunar_margin.site_profile import evaluate_time_step
from lunar_margin.metrics import summarize_binary_visibility
from lunar_margin.rf_link import RFConfig

# Replace with your local kernel paths.
KERNELS = [
    "kernels/naif0012.tls",
    "kernels/de440s.bsp",
    "kernels/pck00011.tpc",
    "kernels/moon_pa_de421_1900-2050.bpc",
    "kernels/moon_080317.tf",
]

START = datetime(2028, 11, 15, tzinfo=timezone.utc)
HOURS = 24 * 7
STEP_HOURS = 1
USE_RF = True


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def main():
    load_kernels(KERNELS)
    rows = []

    rf = RFConfig() if USE_RF else None

    with TerrainModel(DEFAULT_DEM_URL) as terrain:
        for site_name, site in SITES.items():
            print(f"Building horizon: {site_name}")
            horizon = terrain.horizon_profile(
                site["lat_deg"],
                site["lon_deg"],
                az_step_deg=2.0,
            )

            for k in range(0, HOURS + 1, STEP_HOURS):
                t = START + timedelta(hours=k)
                rows.append(
                    evaluate_time_step(
                        iso(t),
                        site_name,
                        site["lat_deg"],
                        site["lon_deg"],
                        horizon,
                        rf_config=rf,
                    )
                )

    df = pd.DataFrame(rows)
    out = Path("outputs")
    out.mkdir(exist_ok=True)
    df.to_csv(out / "site_trade_timeseries.csv", index=False)

    summary_rows = []
    for site_name, group in df.groupby("site"):
        sun = summarize_binary_visibility(group["time_utc"].tolist(), group["sun_visible"].tolist())
        earth = summarize_binary_visibility(group["time_utc"].tolist(), group["earth_visible"].tolist())
        summary_rows.append(
            {
                "site": site_name,
                "solar_availability": sun.availability_fraction,
                "longest_illumination_h": sun.longest_visible_hours,
                "longest_darkness_h": sun.longest_blocked_hours,
                "dte_geo_availability": earth.availability_fraction,
                "longest_dte_contact_h": earth.longest_visible_hours,
                "longest_earth_blackout_h": earth.longest_blocked_hours,
            }
        )

    summary = pd.DataFrame(summary_rows)
    summary.to_csv(out / "site_trade_summary.csv", index=False)
    print(summary.to_string(index=False))


if __name__ == "__main__":
    main()
