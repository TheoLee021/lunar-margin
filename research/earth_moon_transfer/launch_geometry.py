#!/usr/bin/env python3
"""
Four-input launch-site / Earth parking-orbit geometry trade.

Inputs:
  1. --launch-site: four approximate pad presets.
  2. --parking-km: Earth circular parking altitude.
  3. --parking-inc-deg: intended inertial parking inclination.
  4. --azimuth-deg: intended INERTIAL horizontal heading at orbit insertion,
                    clockwise from north (not pad steering azimuth).

Supply inclination OR azimuth, or both to cross-check consistency.
If neither is given, choose the due-east ideal launch (azimuth 90 deg).

Outputs are geometric screening/proxies ONLY. Range safety, actual launch
ascent/steering, UTC/RAAN alignment, vehicle performance and lunar transfer
3D targeting are NOT modeled. No site-specific launch delta-v is claimed.
"""
from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

MU_E = 398600.435436
R_E = 6378.1363
OMEGA_E = 7.2921150e-5  # rad/s, sidereal Earth spin


@dataclass(frozen=True)
class LaunchSite:
    key: str
    name: str
    country: str
    latitude_deg: float
    longitude_deg: float
    location_note: str


# Individual launch-pad coordinates; study presets, not pad permissions.
# Reference sources cited in README.md.
SITES = {
    "kennedy": LaunchSite("kennedy", "Kennedy Space Center LC-39A", "USA",
                          28.608402, -80.604201, "East-coast maritime ascent is typical; verify specific launch corridor."),
    "vandenberg": LaunchSite("vandenberg", "Vandenberg SLC-4E", "USA",
                             34.6320, -120.6107, "Actual range usually prioritizes high inclination/polar trajectories; theoretical eastbound headings can be prohibited."),
    "kourou": LaunchSite("kourou", "Guiana Space Centre ELA-4", "France (French Guiana)",
                         5.256319, -52.786838, "Near-equatorial site; eastbound range availability depends on vehicle and mission."),
    "tanegashima": LaunchSite("tanegashima", "Tanegashima Yoshinobu LP-2", "Japan",
                              30.400938, 130.97564, "Local ascent corridor and vehicle capability must be evaluated separately."),
}


def circular_speed_km_s(altitude_km: float) -> float:
    if not 100 <= altitude_km <= 2000:
        raise ValueError("Study altitude must be 100–2000 km")
    return float(np.sqrt(MU_E/(R_E+altitude_km)))


def period_minutes(altitude_km: float) -> float:
    return float(2*np.pi*np.sqrt((R_E+altitude_km)**3/MU_E)/60.0)


def inferred_inclination_deg(latitude_deg: float, inertial_azimuth_deg: float) -> float:
    """Spherical direct insertion, no dogleg or plane change."""
    angle = np.cos(np.deg2rad(latitude_deg))*np.sin(np.deg2rad(inertial_azimuth_deg))
    return float(np.rad2deg(np.arccos(np.clip(angle, -1.0, 1.0))))


def allowed_inertial_azimuths(latitude_deg: float, inclination_deg: float) -> list[float]:
    """Return both geometric north- and southbound azimuths for target inclination."""
    if not 0 <= inclination_deg <= 180:
        raise ValueError("Inclination must be in [0,180] deg")
    c = np.cos(np.deg2rad(inclination_deg))/np.cos(np.deg2rad(latitude_deg))
    if c < -1-1e-10 or c > 1+1e-10:
        return []
    a = float(np.rad2deg(np.arcsin(np.clip(c,-1,1))))
    northbound = a % 360.0
    southbound = (180.0-a) % 360.0
    return [northbound] if abs(northbound-southbound)<1e-8 else [northbound,southbound]


def analyze(
    site: str = "kennedy",
    parking_km: float = 200.0,
    parking_inc_deg: float | None = None,
    azimuth_deg: float | None = None,
) -> dict:
    if site not in SITES:
        raise ValueError(f"Unknown site {site!r}; choose from {list(SITES)}")
    s = SITES[site]
    vc = circular_speed_km_s(parking_km)
    if azimuth_deg is not None and not 0 <= azimuth_deg < 360:
        raise ValueError("Azimuth must be >=0 and <360 deg")
    if parking_inc_deg is not None and not 0 <= parking_inc_deg <= 180:
        raise ValueError("Inclination must be in [0,180] deg")

    # When unspecified assume due-east insertion; avoid silently assigning a
    # low-inclination lunar orbit to a latitude-constrained ground launch.
    if parking_inc_deg is None and azimuth_deg is None:
        azimuth_deg = 90.0
        parking_inc_deg = inferred_inclination_deg(s.latitude_deg, azimuth_deg)
        method = "default due-east idealized insertion"
    elif parking_inc_deg is None:
        parking_inc_deg = inferred_inclination_deg(s.latitude_deg, azimuth_deg)
        method = "inclination inferred from inertial azimuth"
    elif azimuth_deg is None:
        method = "inertial azimuth inferred from desired inclination"
    else:
        method = "inclination and azimuth cross-checked"

    candidates = allowed_inertial_azimuths(s.latitude_deg, parking_inc_deg)
    geometric_access = bool(candidates)
    if azimuth_deg is None:
        azimuth_deg = candidates[0] if candidates else None
    derived_inc = (inferred_inclination_deg(s.latitude_deg, azimuth_deg)
                   if azimuth_deg is not None else None)
    residual = abs(derived_inc-parking_inc_deg) if derived_inc is not None else None
    consistent = bool(geometric_access and residual is not None and residual < .05)

    vrot = OMEGA_E*R_E*np.cos(np.deg2rad(s.latitude_deg))
    heading_component = (vrot*np.sin(np.deg2rad(azimuth_deg))
                         if azimuth_deg is not None else None)
    # Illustrative horizontal inertial-to-ground-relative vector correction.
    # NOT a rocket ascent delta-v: calculated at pad radius, ignores ascent.
    vground_proxy = (float(np.sqrt(max(0,vc**2+vrot**2-2*vc*heading_component)))
                     if heading_component is not None else None)

    return {
        "inputs": {
            "launch_site": site,
            "parking_altitude_km": parking_km,
            "target_inclination_deg": parking_inc_deg,
            "inertial_launch_azimuth_deg": azimuth_deg,
        },
        "launch_site": asdict(s),
        "calculation_method": method,
        "geometry": {
            "direct_insertion_geometry_possible": geometric_access,
            "input_consistency_pass": consistent,
            "inferred_inclination_deg": derived_inc,
            "inclination_mismatch_deg": residual,
            "two_inertial_azimuth_solutions_deg": candidates,
            "minimum_direct_inclination_deg": abs(s.latitude_deg),
            "earth_surface_rotational_speed_km_s": float(vrot),
            "earth_rotational_velocity_along_heading_km_s":
                float(heading_component) if heading_component is not None else None,
            "parking_circular_orbit_speed_km_s": vc,
            "parking_period_minutes": period_minutes(parking_km),
            "ground_relative_horizontal_speed_proxy_km_s": vground_proxy,
        },
        "status": (
            "GEOMETRY_POSSIBLE_NOT_OPERATIONALLY_VERIFIED" if consistent
            else "NO_DIRECT_INSERTION_OR_INCONSISTENT_INPUT"
        ),
        "limitations": {
            "actual_ascent_simulated": False,
            "launch_azimuth_is_inertial_not_pad_command": True,
            "range_safety_checked": False,
            "actual_UTC_and_RAAN_checked": False,
            "lunar_transfer_plane_coupled": False,
            "site_specific_launch_delta_v_computed": False,
        },
        "note": "Do not add the speed proxy to TLI + LOI. No site-dependent transfer solution is computed."
    }


def comparison(parking_km: float, target_inc_deg: float = 40.0) -> list[dict]:
    return [analyze(k, parking_km, target_inc_deg, None) for k in SITES]


def export(out: Path, selected: dict, sites: list[dict]):
    out.mkdir(parents=True, exist_ok=True)
    (out/"launch_site_geometry.json").write_text(json.dumps(selected, indent=2)+"\n")
    records = []
    for r in sites:
        geo = r["geometry"]
        records.append({
            "launch_site":r["inputs"]["launch_site"],
            "latitude_deg":r["launch_site"]["latitude_deg"],
            "longitude_deg":r["launch_site"]["longitude_deg"],
            "target_inclination_deg":r["inputs"]["target_inclination_deg"],
            "direct_insertion_geometry_possible":geo["direct_insertion_geometry_possible"],
            "inertial_azimuth_deg":r["inputs"]["inertial_launch_azimuth_deg"],
            "earth_rotation_eastward_km_s":geo["earth_surface_rotational_speed_km_s"],
            "earth_rotation_along_heading_km_s":geo["earth_rotational_velocity_along_heading_km_s"],
            "parking_circular_speed_km_s":geo["parking_circular_orbit_speed_km_s"],
        })
    with (out/"launch_site_comparison.csv").open("w",newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(records[0]))
        w.writeheader()
        w.writerows(records)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(10,5.8),dpi=150)
    names=[s["launch_site"]["name"].replace(" Space Center","") for s in sites]
    good=[s["geometry"]["input_consistency_pass"] for s in sites]
    vals=[s["geometry"]["earth_rotational_velocity_along_heading_km_s"] or 0 for s in sites]
    bars=ax.bar(names, np.array(vals)*1000,
                color=["#157a8c" if x else "#b26c6c" for x in good],width=.62)
    for b,s in zip(bars,sites):
        az=s["inputs"]["inertial_launch_azimuth_deg"]
        label=f'Az {az:.1f}°' if az is not None else 'Not geometrically possible'
        ax.text(b.get_x()+b.get_width()/2,b.get_height()+8,label,ha="center",fontsize=9)
    ax.set(ylabel="Earth rotation along idealized insertion velocity [m/s]",
           title=f"Four launch-site geometry cases | {selected['inputs']['parking_altitude_km']:.0f} km LEO"
             f" | Target inclination {sites[0]['inputs']['target_inclination_deg']:.1f}°")
    ax.set_ylim(0,max(500,max(vals)*1200));ax.grid(axis="y",alpha=.2)
    ax.tick_params(axis="x",labelrotation=15)
    fig.text(.5,.01,"Inertial azimuth only. NOT vehicle performance, TLI cost or launch-range authorization.",
             fontsize=9,ha="center")
    fig.tight_layout(rect=(0,.04,1,1))
    fig.savefig(out/"08_launch_site_geometry_trade.png",dpi=180)
    plt.close(fig)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--launch-site",choices=sorted(SITES),default="kennedy")
    p.add_argument("--parking-km",type=float,default=200)
    p.add_argument("--parking-inc-deg",type=float,default=None)
    p.add_argument("--azimuth-deg",type=float,default=None,
                   help="Inertial horizontal azimuth clockwise from north; NOT launch-pad steering")
    p.add_argument("--compare-inc-deg",type=float,default=40.0,
                   help="Shared target inclination used for all-four-site trade")
    p.add_argument("--output",default="output")
    args=p.parse_args()
    selected=analyze(args.launch_site,args.parking_km,args.parking_inc_deg,args.azimuth_deg)
    sites=comparison(args.parking_km,args.compare_inc_deg)
    export(Path(args.output),selected,sites)
    print(json.dumps(selected,indent=2))
    print("Four-site trade saved under",Path(args.output).resolve())


if __name__=="__main__":
    main()
