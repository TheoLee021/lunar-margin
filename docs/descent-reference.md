# Preliminary powered descent reference — NOT an optimized or certified landing

This experimental module answers a narrow question: **Can one of fifteen
prescribed Moon-fixed 3-DOF trajectory shapes reach each of up to four
specified south-polar targets without exceeding the given propulsion and
LOLA terrain-screening constraints?** A pass is a *reference-profile
feasibility result*, **not** a safe landing certificate.

## What is implemented

- Synthetic 100 × 15 km descent-ellipse periapsis/PDI reference based on
  vis-viva with a 100 km circular-orbit departure impulse. The DOI speed
  change is about 19.46 m/s, DOI-to-periapsis time about 56.9 minutes, and
  periapsis speed about 1.692 km/s (ideal two-body Moon).
- A deliberately approximate MOON_ME spinning-frame initial velocity,
  with a prescribed approach azimuth and 300 km default surface range.
- Quintic reference position polynomials satisfying PDI position/velocity
  and zero terminal velocity, plus optional radial loft. Analytic velocity
  and acceleration derivatives; inverse dynamics estimate thrust and
  integrated propellant for each trajectory.
- Fifteen candidate shapes per target (5 durations × 3 loft heights);
  select the feasible case with minimum *calculated* propellant among
  those shapes, or report why no tested shape passed.
- Propulsion acceleration and mass depletion integrated on a separate <=0.5 s grid, independent of the ~5 s reporting grid. This reduces missed inter-sample thrust peaks, but is not a continuous-time guarantee.\n- LOLA DEM sampled along the entire candidate track. Terrain clearance
  evaluated with dense time samples (initial-speed-based 40 m track
  spacing, <=0.2 s) **independently** of 5-second thrust samples.
  NaN data yields TERRAIN_UNKNOWN, never assumed flat.
- The nominal site and up to three nearby alternative coordinates share
  the **same** initial PDI state. Thus B/C comparisons include the change
  in required thrust and propellant, rather than spatial distance only.
- Optional **geometric** Earth LOS at saved flight samples, using SPICE
  simultaneous Earth positions in MOON_ME and sampled LOLA terrain heights,
  including terrain below the lunar reference radius.
  VISIBLE/BLOCKED/UNKNOWN status does **not** imply an operational RF link.

## API

`POST /trajectory/descent-reference`

Example body:

```json
{
  "epoch_utc": "2027-01-10T00:00:00Z",
  "primary_site": {"lat_deg": -89.0, "lon_deg": 30.0},
  "backup_sites": [
    {"lat_deg": -89.001, "lon_deg": 30.02}
  ],
  "approach_azimuth_deg": 90.0,
  "approach_range_km": 300.0,
  "clearance_m": 50.0,
  "include_earth_los": true,
  "vehicle": {
    "wet_mass_kg": 1200,
    "dry_mass_kg": 450,
    "max_thrust_n": 15000,
    "min_thrust_n": 0,
    "isp_s": 310
  }
}
```

Response: `model: REFERENCE_ONLY_NOT_FLIGHT_CERTIFIED`,
`pdi` initial state in Moon-fixed metres/m/s, and `results` with
site-specific `path.status`, sampled flight position/AGL/thrust/mass,
estimated propellant and optional Earth LOS statuses.

Vehicle parameters **are synthetic examples**, not an asserted CLPS
vendor lander spec. DEM and SPICE data remain external to Git. Run with
`DATA_DIR` configured and valid downloaded NASA inputs.

## Explicit limitations / required next milestones

1. **Not connected to the dated Earth–Moon transfer solver.**
   Existing `transfer.py` ends with 100 km LOI and 14h propagation.
   Its current public API does not return full velocity states, nor does
   its freely selected capture orbit target the chosen landing site.
   A mission-specific transfer/plane-change and separation handoff is
   required before claiming 100 km → 15 km → touchdown continuity.
2. **Not an optimal-control solver.** Minimizing propellant among fifteen
   preset polynomial profiles is not proof of an optimum and failing all
   profiles is not proof of *physical* infeasibility. No powered
   ascent/abort option, attitude dynamics, throttle response, gimbal
   limit, slew rate, or terminal contact/gear dynamics is modeled.
3. **Simplified lunar rotation and gravity.** Constant spin and spherical
   two-body lunar gravity are short-arc approximations; the actual
   Moon-fixed frame orientation varies according to SPICE lunar
   orientation kernels. Need inertial dynamics and epoch-correct
   transformations in the next milestone.
4. **No real-time hazard detection or closed-loop replan.** All terrain
   screening uses a preloaded orbital DEM; small rocks, crater rims
   below DEM effective resolution, dust, plume–surface interaction,
   uncertainty in navigation or elevation, and the footpad/contact
   dynamics are not certified.
5. **Earth LOS only, no relay.** Geometric line-of-sight uses a 12 km
   altitude escape heuristic and 80 m ray sampling, with UNKNOWN for
   incomplete coverage. It is not a complete RF link or a flight
   communications requirement evaluation. Earth LOS on the moving
   descent profile must not be confused with the stationary site's
   longer-term Earth visible fraction.
6. **Independent dynamics consistency checks, not flight validation.** A separate SciPy `solve_ivp` forward integration in an inertial frame checks the polynomial-derived acceleration, rotating-frame terms and endpoint, and an independently sampled mass integral checks consumption. A targeted regression verifies that a thrust peak missed by 5 s display sampling fails a marginal engine limit. These checks use the same idealized gravity, rotation and derived acceleration as the model; they do **not** establish realistic closed-loop guidance or actuator feasibility. Synthetic flat-surface, ridge,
   missing-DEM, thrust/fuel and alternate-target unit tests are
   reproducible. A separate real-LOLA case, reference-mission
   cross-check, trajectory integration with an independent solver,
   and Monte Carlo dispersions are required before using the results
   to make operational claims.

## Next recommended engineering sequence

1. Reconcile exact 100 km LOI and a physically consistent 100×15 km
   perilune with arbitrary target latitude, mission date and orbital
   plane. Preserve full position + velocity at every phase boundary.
2. Use a full inertial SPICE frame transform and independently
   integrate polynomial-profile thrust acceleration to verify endpoint
   and fuel results.
3. Introduce finite gimbal/attitude limits and continuous-time
   terrain/geofence checks. Replace the profile library with
   constrained nonlinear optimization (then SOCP/SCP as justified).
4. Add reachable/divertable target envelopes from arbitrary mid-descent
   state, with adequate reserves and **explicit** NO_SOLUTION vs
   NO_FEASIBLE_LANDING semantics.
5. Validate against an independent lunar descent published case and
   perform DEM uncertainty, propulsion dispersions and onboard
   navigation error Monte Carlo tests.

References for the algorithm family:

- Açıkmeşe & Ploen (2007), *Convex Programming Approach to Powered
  Descent Guidance for Mars Landing*, JGCD,
  https://doi.org/10.2514/1.27553
- Berning et al. (2023), *Lossless Convex Guidance for Lunar Powered
  Descent*, AIAA SciTech.
- Srinivas et al. (2024), *Lunar Landing with Feasible Divert using
  Controllable Sets*, https://www.merl.com/publications/TR2024-004

No claim is made that these works endorse or validate this prototype.


## Scoped physics verification update (2026-11-15)

- Scope is confined to the existing descent engine, its dedicated physics
  tests, and this document. No changes to shared transfer, DEM, RF, SPICE,
  frontend, or site-ranking modules; PR remains Draft.
- Before correction, a 600 s, zero-loft synthetic flat-DEM profile had a
  ~6169.34 N peak on the 5 s sampling grid but a ~6170.25 N peak with
  0.1 s sampling. Thus a 6170 N engine could be reported as passing.
  The propulsion pass/fail computation now uses <=0.5 s samples, while
  the public trajectory sample count remains unchanged.
- The new forward-integration test verifies internal model consistency,
  not a flown trajectory. It uses the time-dependent acceleration derived
  analytically from the prescribed polynomial, so zero endpoint error
  does not validate an actual guidance/controller implementation.
- Verification gaps remain: rigorous time-varying SPICE frame mapping;
  actuator dynamics, throttle/slew/gimbal limits; sampled-versus-continuous
  thrust/terrain guarantees; navigation dispersions; uncertainty in terrain
  heights; and an independent published descent benchmark.
