# Physics & Methods

**Status:** current implementation is a preliminary analysis tool, not landing-site certification.

## Question
For a site, time window, and observer height, when are the Sun and Earth geometrically above the surrounding terrain horizon? How do resulting access windows vary with landing date and selected site?

## Data and model
- **Terrain:** LRO LOLA polar DEM, primary 80 m/px at 80–90°S; supplemental 120 m/px at 75–90°S where primary has no coverage, per [data catalog](../data.md).
- **Ephemerides:** NAIF SPICE with JPL DE440s and lunar orientation/frame kernels; see [data catalog](../data.md).
- **Calculation:** from lunar surface point, compute azimuth-dependent terrain horizon H(a). Get time-dependent apparent/geometric direction of Sun/Earth from SPICE according to actual implementation. A body is geometrically visible when its elevation e(t) exceeds H(a(t)).
- **Metrics:** access fraction, longest continuous darkness/communication geometric blackout, interval windows and their temporal overlap.
- **Site filtering:** candidate pipeline evaluates hard thresholds first, then ranks eligible sites on soft Sun/Earth weights. See [candidate methodology](../candidates.md).

## Interpretation
`Sun visible` does **not** mean enough solar-array power; it excludes solar array orientation, shadow within the lander's own geometry, battery SOC, degradation, and thermal-control loads.
`Earth visible` does **not** certify a working RF link; it excludes antenna pointing, interference, data rates, ground stations, modulation, and link margins.
An 80 m DEM cannot resolve individual rocks, small boulders, or precise touchdown hazards.

## Orbital extension: deliberately separate
The repo also provides a preliminary Earth–Moon transfer visualization driven by SPICE Moon states and a Lambert-based shooting solution toward 100 km lunar perilune, with a notional parking orbit and LOI. It excludes launch ascent, solar and nonspherical perturbations, finite burns and lunar powered descent. Do **not** equate its internally small targeting residuals with independently validated flight trajectory accuracy. Consult [repository README](../../README.md) and [API documentation](../api.md).

## Reference resources
- [NASA PDS Geosciences LRO / LOLA](https://pds-geosciences.wustl.edu/missions/lro/default.htm)
- [NASA/JPL NAIF SPICE](https://naif.jpl.nasa.gov/naif/)
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) — independent *celestial geometry* comparison, not a terrain-horizon reference
- [NASA Moon Trek](https://trek.nasa.gov/moon/)
- [LROC QuickMap](https://quickmap.lroc.asu.edu/)

## Pending evidence
- Independent Sun/Earth az/el comparison: date, site, coordinate conventions, angular residual statistics, files.
- DEM/horizon sensitivity: resolution, observer height, azimuth step, coverage and worst-case grazing-angle differences.
- Time-step convergence and verification of event boundaries.
