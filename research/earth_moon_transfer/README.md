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
