# 3D Lunar Flight Reference — integration preview

**Review status:** Integration preview branch only. **Do not merge this branch to main.** It combines the still-reviewed code from #70, #74 and #69 so the full flow can be tested without modifying those review branches.

## User workflow

1. Open a selected site in the Lunar Margin mission dashboard.
2. Choose **3D Flight Reference** to open `/flight?departure=...&arrival=...&lat=...&lon=...`.
3. Enter UTC departure/arrival dates (1–10 days apart), target coordinates, a PDI site-alignment tolerance, and an **illustrative lander** at PDI (wet mass, dry mass, max thrust and Isp).
4. Select **Compute Reference Flight**. The API computes the dated transfer; #70 supplies the real post-LOI 6D state; #74 searches an ideal DOI orbit to PDI; #69 evaluates one explicitly specified 720-second/zero-loft polynomial descent **only if the PDI alignment gate passes**.
5. The existing Cesium Moon Viewer plots the timed MOON_ME Cartesian orbit segments and, if evaluated, the descent reference. Play, pause or scrub the moving marker, reading reference altitude and estimated thrust.
6. `NO_PDI_REFERENCE` returns **no descent**. `DESCENT_REFERENCE_FAILED` may still provide a reference shape for diagnosis: it does **not** imply a safe or feasible landing. `DESCENT_REFERENCE_PASSED` means one tested polynomial profile passed under the idealized model only.

## Data interface

`POST /trajectory/flight-preview`

```json
{
  "departure": "2027-01-06T00:00:00Z",
  "arrival": "2027-01-10T00:00:00Z",
  "latitude": -89,
  "longitude": 30,
  "alignment_tolerance_m": 5000,
  "duration_s": 720,
  "loft_m": 0,
  "wet_mass_kg": 1200,
  "dry_mass_kg": 450,
  "max_thrust_n": 15000,
  "min_thrust_n": 0,
  "isp_s": 310
}
```

The response includes `orbit.loi`, `orbit.doi_pre`, `orbit.doi_post`, `orbit.pdi`, epoch-tagged `orbit.samples` in MOON_ME Cartesian meters, and optional `descent.samples`. The UI converts descent elapsed seconds to UTC relative to the computed PDI event, not the nominal Earth–Moon arrival.

The exact **PDI 6D position/velocity** from #74 feeds the #69 `evaluate_reference` function in this preview. The original #69 `pdi_from_target` synthetic initial-condition generator is **not invoked** in the integrated endpoint. The separate historical #69 endpoint remains available for research and explicitly synthetic use.

## What is NOT claimed

- The dated transfer's captured orbit is a genuine site-targeted polar orbit. The DOI continuation uses an approximate Moon-centered two-body circular/elliptic model and is not the same continuous post-LOI multi-body propagation.
- A successful site alignment gate demonstrates the existence of a real, controllable, fuel-feasible descent trajectory. It only screens the closest **tested reference orbital phase** against an illustrative ground-projection tolerance.
- `Lander` wet/dry mass and propulsion parameters are real CLPS vehicle specifications. They are hypothetical values at **PDI**, and DOI or LOI consumption has not been deducted from their fuel budget.
- The 3D playback is real-time, live-telemetry-driven or an independently validated mission simulation. It plays computed samples at a display cadence, without interpolation or a certified flight controller.
- Public generic launch dates are verified lunar rides, cargo booking opportunities or priced mission manifests.
- The fictional infrastructure companies and equipment are verified real companies or a combined lander payload. They remain **independent modeled customer/asset scenarios**, not automatic lander specifications.

## Visual caveats

- Cesium Moon uses the MOON_ME lunar-fixed frame; orbit and descent points are **3D Cartesian meters**, never passed through `fromDegrees` as if the positions were geodetic.
- The Moon Viewer initially frames the south pole. Upon successful calculation it flies toward the selected landing target.
- No Earth-centered cruise leg is drawn in this Moon-only view; the existing `/orbit` visualization retains the Earth–Moon transfer preview.
- Future flight playback should use actual physical UTC spacing and kinematic interpolation, and optionally show a vehicle body/attitude if attitude states become available.

## Separation after Theo review

After #70, #74 and #69 pass the team's review, move the adapter to a **single-purpose integration PR**, then move Cesium flight rendering to a **separate single-purpose UI PR**. This combined preview is only for proving those pieces can coexist. Do not merge its source snapshots as an alternative to the original reviewed PRs.
