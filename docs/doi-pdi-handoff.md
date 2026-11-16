# Reference LOI → DOI → PDI handoff

**Status:** Experimental orbit-geometry screening, not a lunar landing solution.

## One feature

Given a **dated Earth–Moon transfer that reaches an actual LOI state** and a **selected lunar south-pole surface target**, examine an ideal two-body parking-orbit phase at which a single impulsive tangential DOI produces a 15 km periapsis/PDI. Return the closest PDI ground projection to the selected target, its miss distance, and an epoch-tagged orbit trajectory that can later be rendered by the 3D viewer.

This is intended to supply the missing **physical state handoff**, not to expand the public interface into lander animation or mission-cost pricing.

## Data flow

`calculate_transfer(departure, arrival)` → `loi_handoff.post_loi_j2000_km_kmps` from PR #70 → post-LOI Moon-centered J2000 state (SI) → ideal 100 km parking orbit phase search → instantaneous **DOI** burn lowering perilune to 15 km → two-body coast to PDI → `SPICE sxform(J2000, MOON_ME, epoch)` at each sample → target ground position angular separation.

- Reference positions are expressed both in **Moon-centered J2000 (m)** and **MOON_ME (m)**. Velocities use m/s.
- All epochs are timezone-aware UTC timestamps, not arbitrary frame counters.
- Samples identify `PARKING_COAST` or `DOI_COAST` for future 3D/telemetry playback.
- The target is assumed stationary on the rotating lunar body; `sxform` aligns comparison at each epoch.
- Search one nominal parking period for the DOI phase. Discrete samples identify a promising phase; a local continuous minimization refines it.
- The **two-body reference parking orbit** is an approximation of the production Earth–Moon propagation after LOI. The handoff preserves the actual starting state, but subsequent orbital arcs do not include the Earth's tidal gravity, lunar mascons or epoch-correct lunar gravity potential.
- The output only provides `aligned_pdi_moon_me_m_mps` when the sampled reference miss distance satisfies the requested spatial tolerance. If it fails, `NO_ALIGNED_REFERENCE` must not be interpreted as proof that a real transfer, plane-change, powered descent, or different DOI maneuver is impossible.

## API

`POST /trajectory/doi-pdi-reference`

Example:

```json
{
  "departure": "2027-01-06T00:00:00Z",
  "arrival": "2027-01-10T00:00:00Z",
  "target_lat_deg": -89.0,
  "target_lon_deg": 30.0,
  "pdi_altitude_m": 15000,
  "alignment_tolerance_m": 5000
}
```

Response includes:

- `status`: `REFERENCE_ALIGNED` or `NO_ALIGNED_REFERENCE`
- `loi`, `doi_pre`, `doi_post`, `pdi`: epoch-tagged 6D J2000 + MOON_ME states
- `doi_delta_v_mps`, `coast_time_s`, `approach_error_m`, `plane_offset_m`
- `samples`: per-epoch 3D positions and reference-sphere altitude for later Cesium playback
- `aligned_pdi_moon_me_m_mps`: nullable state; a reference-alignment flag **does not establish powered-descent capability**

This route recomputes the dated transfer and is computationally expensive. Rate limiter allows one request inside this endpoint at a time. No external commerce data is fetched. Not a flight planner or safety certification.

## Persona and hardware boundary

The user's `NASA_App_Challenge_CLPS (2).xlsx` contains **fictional customer organizations and modeled lunar hardware** inspired by public real-world vendors. They are *scenario inputs*, not actual NASA CLPS companies, available flights, or contracts. No mass, power, payload capability, vehicle sizing, thrust, supplier quote, or landing compatibility is inferred from these personas here. In later work, model each company's **selected delivered asset(s)** as payload manifest(s), separate from lander dry mass, consumables, adapter, stage and propellant. No assumption that all customers' equipment is transported in one flight.

## Engineering limitations and next gates

1. **LOI is not a site-targeted orbit.** Target surface location may lie far outside its orbital plane. A 5 km alignment tolerance is a user-chosen illustrative threshold, not a published landing criterion.
2. **Approximate parking and DOI:** post-LOI orbit is treated as near-circular, and DOI is an instantaneous tangential burn. A real flight must check changing gravity, third-body perturbation and finite burn effects. A small handoff residual remains between exact production propagation and subsequent two-body arcs.
3. **No powered landing in this endpoint:** no lander dry/wet mass, Isp, actual thrust, divert reachability, approach surface heading, terrain collisions, descent control, or terminal landing constraints are evaluated.
4. **No unconditional link to #69:** its PDI is still synthetic. Future work must replace synthetic PDI with a *validated* state from this trajectory and explicitly check approach geometry, altitude, ephemeris-frame agreement, mass, propulsion and site-specific landing feasibility before coupling.
5. **Graphics are future work:** this PR supplies numerical epoch-tagged positions only. No Cesium path, play/pause, moving lander mesh, deployment, cable or infrastructure visualization is added.
6. **Validation:** synthetic coplanar/non-coplanar geometry, DOI impulsive continuity, endpoint radius and timestamp tests plus API routing tests. Physics benchmarking against independent ephemerides and actual lander performance remains outstanding.

**Recommended merge order:** #70 state handoff, this orbit reference **after review**, then separate #69 handoff/refinement and separately scoped 3D playback. Keep PR #69 and #70 unchanged while Theo reviews.
