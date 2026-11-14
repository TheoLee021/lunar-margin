# Earth–Moon Direct Transfer: Mission Geometry and LOI Demonstrator

Standalone Python adaptation of the **SELFIE Earth–Mars mission-geometry workflow** to a direct Earth–Moon transfer. This is a reproducible preliminary **mission-design trade** and validation tool, **not flight-navigation software**.

## Run

    python -m pip install -r requirements.txt
    python lunar_transfer.py --output output

Alternative input parameters:

    python lunar_transfer.py --parking-km 400 --perilune-km 200 --skip-trade --output output400

Dependencies: NumPy, SciPy, Matplotlib, and optional Plotly for interactive 3D HTML. Run from this directory.

## Baseline scenario

| Quantity | Baseline |
| --- | --- |
| Earth departure parking altitude | 200 km |
| Mean Earth–Moon separation | 384,400 km |
| Moon orbital model | Circular, inclined 5.145 degrees to reference XY plane |
| Lunar encounter target | 100 km altitude above mean lunar sphere |
| Epoch | Day 0 (not a dated lunar ephemeris) |
| Departure | Tangential instantaneous TLI |
| Capture | Instantaneous LOI at first lunar perilune |
| Post-capture orbit | Near-circular in incoming orbit plane; **not lunar polar** |
| Post-LOI propagation | 14 h |

The Moon is propagated throughout cruise. The algorithm varies initial lunar phase using scalar shooting until the **propagated** first lunar periapsis matches the requested altitude. It uses SciPy's `solve_ivp` and `brentq`; it is **not** a Lambert solver.

Earth-centered spacecraft acceleration:

    r_ddot = -mu_E*r/|r|^3 - mu_M*((r-r_M)/|r-r_M|^3 + r_M/|r_M|^3)

The final term is the indirect third-body acceleration term for Earth-centered coordinates.

TLI injection uses an initial two-body vis-viva estimate; after arrival the whole lunar-relative velocity vector is changed to local tangential circular speed. The resulting LOI cost is a vector magnitude, not an assumed constant.

## Numerical output from the baseline

| Measurement | Result |
| --- | ---: |
| Initial Moon phase angle | 108.341 degrees |
| TLI delta-v | 3.1313 km/s |
| Transfer time | 5.2876 days |
| Actual first perilune altitude | 100.000 km |
| Lunar relative speed before LOI | 2.4518 km/s |
| Target circular speed | 1.6335 km/s |
| LOI delta-v | 0.8183 km/s |
| TLI + LOI | 3.9497 km/s |
| 14-hour post-LOI altitude range | 99.971–100.057 km |
| Earth-only two-body energy drift | 6.3e-11 relative |

**Important:** The target perilune altitude is tuned to 100 km, so hitting that number is **not independent validation** against a real trajectory.

## Outputs (generated, not checked in)

- `output/01_earth_moon_transfer_2d.png` — moving-Moon transfer geometry.
- `output/02_earth_moon_transfer_3d.png` — 3D Earth–Moon trajectory.
- `output/03_lunar_approach_and_capture.png` — Moon-relative LOI.
- `output/04_transfer_range_and_capture_altitude.png` — encounter distance and capture altitude over time.
- `output/05_impulsive_dv_budget.png` — separate TLI and LOI impulsive costs.
- `output/06_interactive_3d.html` — rotatable self-contained Plotly plot (if Plotly installed).
- `output/07_parking_orbit_trade.png` — comparison of 200, 400, 800 km parking orbits.
- `output/mission_metrics.json` — assumptions and calculated metrics.
- `output/parking_orbit_trade.csv` — trade data.

The generated outputs are ignored by Git intentionally: the source code reproduces the results and the Plotly HTML alone is about 5 MB.

## Launch-site and parking-orbit inputs (v1.1)

The main script now exposes **four launch-geometry inputs**:

| Input | Flag | Example | Interpretation |
| --- | --- | --- | --- |
| Launch pad (choose 1 of 4) | `--launch-site` | `kennedy` | Site latitude/longitude preset |
| Earth parking altitude | `--parking-km` | `200` | Circular LEO altitude above reference sphere |
| Desired parking inclination | `--parking-inc-deg` | `40` | Direct-insertion plane inclination, geocentric idealization |
| Initial inertial heading | `--azimuth-deg` | `60.76` | Horizontal **inertial** azimuth clockwise from north, **not launch-pad command** |

**Inclination and azimuth are intentionally cross-checked, not independent degrees of freedom.** Supply either one; the other will be inferred from the launch-site latitude. If both are supplied and conflict, the combined transfer command aborts with an explicit message. If both are omitted, a due-east idealized parking plane is assumed.

Launch-pad presets:

| Key | Facility | Latitude | Longitude | Notes |
| --- | --- | ---: | ---: | --- |
| `kennedy` | Kennedy LC-39A, USA | 28.608402° N | −80.604201° | Eastbound examples; actual range review required |
| `vandenberg` | Vandenberg SLC-4E, USA | 34.6320° N | −120.6107° | Actual range favors high-inclination/polar launches; illustrative eastbound solutions may not be licensed |
| `kourou` | Guiana Space Centre ELA-4, France/French Guiana | 5.256319° N | −52.786838° | Equatorial-access advantage |
| `tanegashima` | Yoshinobu LP-2, Japan | 30.400938° N | 130.975640° E | Vehicle/flight-safety constraints not modeled |

Sources for coordinates: [NASA LC-39A location](https://netspublic.grc.nasa.gov/main/LC%2048%20Environmental%20Assessment%20with%20Appendices_02.19.2019.pdf), [Falcon Payload User's Guide `6.5 SLC-4E](https://web.mit.edu/course/2/2.70/Reading%20Materials/SpaceX%20Falcon-users-guide-2021-09.pdf), [Launch Library ELA-4](https://lldev.thespacedevs.com/2.2.0/launch/7911261d-1a3a-4252-b00f-9de5b42de73d/?format=api), and [Launch Library Yoshinobu LP-2](https://lldev.thespacedevs.com/2.2.0/launch/3a4dc969-d264-48a1-b113-bf69a798a5c4/?format=api).

Run a full example:

```bash
python lunar_transfer.py \
  --launch-site kennedy \
  --parking-km 200 \
  --parking-inc-deg 40 \
  --output output40
```

Run site screening only (including **physically inconsistent** examples):

```bash
python launch_geometry.py --launch-site vandenberg --parking-km 200 --parking-inc-deg 20 --output output_invalid
```

For the standalone screening output:

- `launch_site_geometry.json`: selected-site inputs, geometric consistency, rotation/velocity metrics, limitations.
- `launch_site_comparison.csv`: four site presets at shared target inclination (`--compare-inc-deg 40` default).
- `08_launch_site_geometry_trade.png`: inclination access and heading trade, **not** rocket performance.
- `mission_metrics.json` from main includes the screening verdict and the flag `transfer_plane_coupled_to_launch_site = false`.

### Physical geometry and the important invariant

The first-order spherical-Earth launch geometry is:

```text
cos(i) = cos(latitude) * sin(A_inertial)
v_earth_east = omega_earth * R_earth * cos(latitude)
v_earth_along_heading = v_earth_east * sin(A_inertial)
```

Therefore, for a **fixed target inclination** with a directly attainable plane:

```text
v_earth_along_heading = omega_earth * R_earth * cos(i)
```

This **is the same for all four sites** in the simplified model. For a 40° orbit the projection is about **356.29 m/s**, regardless of selected location, although the required inertial azimuth differs by site. A physically valid transfer comparison cannot infer "best launch site" solely from the eastward surface speed.

The heading is **inertial at idealized insertion** and differs from actual pad azimuth due to rotating-Earth ascent, winds, gravity turn, winds aloft, launch vehicle steering and local constraints. No range-safety or downrange hazard avoidance is modeled. See the [NASA launch-azimuth geometry reference](https://www.govinfo.gov/content/pkg/GOVPUB-D301-PURL-gpo106217/pdf/GOVPUB-D301-PURL-gpo106217.pdf).

**Critical separation:** The existing `lunar_transfer.py` propagator still assumes a fixed lunar-plane-aligned transfer (5.145° relative to its reference XY plane). The extra inputs currently diagnose the **ground-launch/parking-orbit** geometry; they do *not* rotate the TLI spacecraft state, retarget the Moon, change lunar arrival speed or imply successful TLI-plane alignment. Changing launch site at unchanged parking altitude therefore does not change its reported TLI + LOI. That is **intentional, not an optimization result.**

To genuinely couple launch site to the transfer, a follow-on dated 3D boundary-value solver must include: UTC, Earth rotation/ECI–ECEF, RAAN, orbital argument of latitude at TLI, realistic Moon ephemerides, injection direction and speed, and range/launch vehicle constraints. An additional input—**launch UTC**—will be required at that fidelity level.

Run the launch geometry tests from this folder:

```bash
python -m unittest -v test_launch_geometry.py
```


## v1.2: 100-km lunar orbit to powered touchdown (standalone lander)

This is a **separate, idealized descent-stage mission segment**, not a continuation of the full transfer spacecraft state. The Earth–Moon transfer captures into a near-circular orbit in its incoming plane; this lander demonstrator assumes an independently supplied circular lunar orbit with no specific latitude/longitude. **It does not establish south-pole landing feasibility.**

Run (from this directory):

```bash
python lunar_descent.py --orbit-km 100 --pdi-km 15 --mass-kg 1650 --dry-mass-kg 650 --thrust-n 8500 --isp-s 310 --output output_descent
python -m unittest -v test_lunar_descent.py
```

Scenario model:
- Initial lunar circular orbit: altitude 100 km, orbital speed about 1,633.5 m/s.
- **DOI (descent orbit insertion):** instantaneous retrograde impulse at 100 km to an ellipse with 15-km perilune; DOI Δv ~19.46 m/s.
- **Coast:** half of a two-body Kepler ellipse, about 56.86 min, reaching the 15-km perilune with ~1,692.34 m/s tangential speed.
- **PDI (powered descent initiation):** finite-thrust, throttleable descent of a hypothetical 1,650-kg wet lander using a maximum 8,500-N engine, Isp 310 s, dry-mass limit 650 kg.
- Guidance uses ideal state feedback: staged reference radial descent speed, along-track velocity decay, and a thrust magnitude limiter. It is not optimized, and the physical thrust vector may point in arbitrary directions within the chosen 2D plane.
- **Touchdown criterion:** radial speed ≤1.5 m/s and tangential speed ≤2.0 m/s, mass exceeding dry mass by ≥1 kg; smooth mean-radius sphere, no hazards.

Tested baseline numerical results (rounded):
| Quantity | Baseline |
| --- | ---: |
| DOI Δv | 19.455 m/s |
| DOI propellant, impulsive rocket-equation approximation | 10.53 kg |
| DOI coast duration | 56.86 min |
| Powered descent duration | 12.34 min |
| Powered descent integrated thrust/mass | ~2,390 m/s |
| Powered-descent propellant | 893.4 kg |
| Total DOI + powered-descent propellant | 903.9 kg |
| Final propellant above dry mass | 96.1 kg |
| Final radial speed | −0.700 m/s |
| Final tangential speed | +0.24 m/s |
| Computed in-plane surface-arc downrange from PDI | ~253 km |
| Landing criterion | PASS for this *idealized mathematical* case |

**Do not add 2,390 m/s and 19.455 m/s to the earlier Earth–Moon TLI+LOI cost as a validated full-mission budget.** The v1 transfer spacecraft and v1.2 lander have not been modeled with consistent separation staging, vehicle masses, injection planes, or full-mission launch and descent constraints. The 2,390 m/s is the integral of thrust acceleration during descent, not an instantaneous engine burn.

Outputs:
- `08_deorbit_to_landing_full.png`: 100-km reference orbit, DOI coast, powered descent, touchdown.
- `09_descent_groundtrack.png`: powered descent altitude vs downrange.
- `10_descent_time_history.png`: altitude, radial/tangential velocity, thrust.
- `11_descent_mass_budget.png`: propellant depletion relative to dry mass.
- `descent_history.csv` and `descent_metrics.json`: reproducible sampled states and assumptions.

**Not included:** lunar polar targeting; real Moon-fixed coordinates/rotation; landing site/time; Sun/Earth visibility or terrain/DEM; navigation covariance; engine restart dynamics, minimum throttle, gimbal limits, slew rates, thermal limits, leg contact or shock; lunar mascons and perturbations; actual fuel reserves and flight rules. All dimensions and performance numbers are illustrative. In particular, landing on the spherical mean lunar radius is **not** a hazardous-terrain-safe landing.

Next integration for UMBRA / Lunar Margin: dated lunar polar orbit state → selected landing site (lat/lon) → rotating Moon frame and ground track → altitude relative to LOLA DEM → Sun/Earth line-of-sight intervals → altitude/speed/control constraints → fuel reserve and error Monte Carlo.


## Modeling boundaries

**Modeled:** Earth and Moon point-mass gravity, moving inclined circular Moon, indirect third-body term, event-based first perilune detection, scalar phase targeting, instantaneous TLI and LOI, Earth-only energy conservation check, 14-hour capture propagation.

**Not modeled:** JPL DE440/SPICE real ephemerides or launch dates, Sun gravity, lunar eccentricity, Earth J2, lunar mascons, finite burns, launch vehicles/sites, navigation covariance, B-plane targeting, true polar orbit insertion, surface descent/landing, communications, site terrain horizons, or solar availability.

The 5.145-degree inclination is relative to a chosen reference plane, not a time-dependent Earth equator or an accurately defined ecliptic of date. The departure lunar phase is a **relative model input**, not a longitude corresponding to a real calendar date.

## Verification checklist

1. Does the Earth-only test conserve orbital energy to within the asserted tolerance?
2. Is the lunar periapsis identified by zero relative radial velocity?
3. Is the Moon's position evaluated continuously instead of frozen at departure?
4. Does LOI zero radial speed and set the local target circular tangential speed?
5. Does the captured spacecraft stay clear of the Moon over the modeled time window?
6. Are computed results distinguished from assumptions and excluded effects?

## Context and follow-on work

This experiment is separate from the production Lunar Margin solar / Earth visibility engine. The relevant workflow for Lunar Margin is:

    Dated transfer -> lunar arrival and polar-orbit targeting
                   -> candidate surface site/date
                   -> SPICE Sun/Earth directions
                   -> terrain horizon
                   -> visibility continuity, risk and operational margins

The next fidelity upgrade is real dated Sun/Earth/Moon ephemerides with a physically controlled lunar arrival plane, then coupling to the existing Lunar Margin landing-site/date trade. **Do not interpret the current trajectory as a landing-feasibility calculation.**

References: [NASA Moon fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html), [JPL DESCANSO lunar transfers](https://descanso.jpl.nasa.gov/monograph/series12/LunarTraj--05Chapter4TransferstoLowLunarOrbits.pdf).
