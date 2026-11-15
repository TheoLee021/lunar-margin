# Lunar Margin Baseline v1 — VS Code Ready

**For a first local run on Windows/VS Code, start with `README_VSCODE.md`.**


A compact baseline package for the current Lunar Margin hackathon work.

## What is included

### Core mission geometry

`UTC + lunar site -> SPICE -> Sun/Earth azimuth, elevation, range`

### Terrain-aware visibility

`DEM -> 360° terrain horizon H(az) -> Sun/Earth visible?`

### Time-series metrics

- solar availability
- longest continuous illumination
- longest darkness
- geometric DTE availability
- longest DTE contact
- longest Earth blackout
- transition count / cadence proxy

### Optional RF extension

`Earth geometric LOS -> FSPL -> received power -> link margin -> nominal DTE status`

The RF layer is intentionally separate from the challenge core.

---

## Architecture

```text
UTC + Site
    |
    +--> SPICE ------------------> Sun az/el/range
    |                              Earth az/el/range
    |
    +--> DEM --------------------> elevation / terrain horizon H(az)
                                   |
                                   v
                             visibility()
                                   |
                      +------------+-------------+
                      |                          |
                 Sun time series            Earth time series
                      |                          |
                 illumination                DTE geometry
                      |                          |
                      |                     optional RF
                      |                          |
                      +------------+-------------+
                                   |
                              Site trade
```

---

## Installation

```bash
pip install -r requirements.txt
```

## Required SPICE kernels

Use current NAIF generic kernels. A typical setup includes:

- leap seconds kernel, e.g. `naif0012.tls`
- planetary SPK, e.g. `de440s.bsp`
- generic PCK, e.g. `pck00011.tpc`
- lunar binary PCK, e.g. `moon_pa_de421_1900-2050.bpc`
- lunar frame kernel, e.g. `moon_080317.tf`

Put them in `kernels/` or edit the paths in `scripts/run_trade.py`.

The baseline uses `MOON_ME` for the Moon-fixed frame.

---

## Terrain source

The package is configured to use the NASA PGDA south-pole LOLA Cloud-Optimized GeoTIFF discussed during development:

```text
LDEM_80S_20MPP_ADJ.TIF
```

Default remote path is in `lunar_margin/config.py`.

If `/vsicurl/` access does not work in your environment, download the GeoTIFF and pass its local path to `TerrainModel`.

### Why a DEM rather than QuickMap scraping?

QuickMap is useful for visual inspection and dataset discovery, but the backend should read documented raster products directly. This makes the terrain calculation reproducible and independent of UI changes.

---

## Horizon model

For each azimuth, the code walks outward over the lunar terrain and computes the apparent elevation angle of each terrain point from the landing site.

The maximum angle becomes:

```text
H(azimuth)
```

Visibility is then:

```text
Sun visible   if Sun elevation   > H(Sun azimuth)
Earth visible if Earth elevation > H(Earth azimuth)
```

The terrain angle is computed with Moon-centered Cartesian geometry, so lunar curvature is included.

The default horizon search is a hackathon-speed compromise. Increase azimuth resolution, search range, and distance sampling for higher fidelity.

---

## Minimal example

```python
from lunar_margin.geometry import load_kernels, target_geometry
from lunar_margin.terrain import TerrainModel
from lunar_margin.visibility import visibility_from_horizon

load_kernels([
    'kernels/naif0012.tls',
    'kernels/de440s.bsp',
    'kernels/pck00011.tpc',
    'kernels/moon_pa_de440_200625.bpc',
    'kernels/moon_080317.tf',
])

site_lat = -87.29
site_lon = 140.03
utc = '2028-11-15T12:00:00'

with TerrainModel() as terrain:
    horizon = terrain.horizon_profile(site_lat, site_lon, az_step_deg=2.0)

    sun = target_geometry(utc, site_lat, site_lon, 'SUN')
    sun_vis = visibility_from_horizon(sun['az_deg'], sun['el_deg'], horizon)

    earth = target_geometry(utc, site_lat, site_lon, 'EARTH')
    earth_vis = visibility_from_horizon(earth['az_deg'], earth['el_deg'], horizon)

    print(sun, sun_vis)
    print(earth, earth_vis)
```

---

## 3-site trade runner

Edit kernel paths in:

```text
scripts/run_trade.py
```

Then run:

```bash
python scripts/run_trade.py
```

Outputs:

```text
outputs/site_trade_timeseries.csv
outputs/site_trade_summary.csv
```

---

## RF extension

The RF code follows the team's current Colab logic:

```text
FSPL = 20 log10(4 pi d f / c)
Pr   = Pt + Gt + Gr - FSPL - Lmisc
M    = Pr - Preq
```

Status:

```text
BLOCKED    -> geometric LOS unavailable
LOW MARGIN -> visible, but link margin below target
AVAILABLE  -> visible and margin >= target
```

Important: the defaults are calculation assumptions only. Before presenting them as mission-relevant, replace `Pt`, `Gt`, `Gr`, `Preq`, losses, and frequency with cited mission/ground-station values.

---

## What is intentionally NOT yet modeled

- full landing feasibility
- boulder/crater hazard detection
- probabilistic terrain uncertainty
- partial Sun/Earth disk visibility
- antenna radiation patterns
- pointing loss as a function of attitude
- ground-station scheduling / Earth-side Moon elevation
- Rician fading / detailed multipath
- stochastic shadowing
- residual Doppler
- ARQ / channel coding / BER / throughput
- relay satellites

These are later layers, not blockers for the core Sun/Earth terrain-aware visibility model.

---

## Suggested next steps

1. Validate DEM elevation at a known QuickMap point.
2. Plot the 360° horizon profile.
3. Run a 30-day Sun visibility time series.
4. Add `slope` and `roughness` as separate raster layers rather than inferring them from one DEM without validation.
5. Produce `SiteProfile` JSON for frontend use.
6. Replace RF placeholder values with documented lunar-lander and Earth-ground-station references.
7. Only after the core works, consider relay infrastructure as a stretch feature.
