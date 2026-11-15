# Economics & Logistics

**Status: MODEL ESTIMATES ONLY.** The application is not a booking engine and provides **no verified live fares, reserved mass, or guaranteed launch availability**.

## Scope
Lunar landing-site economics may involve transport cost, contract type, payload mass, lander capacity, eligible destination and timing, and mission redesign risk. Public information is sparse; unknowns must remain unknown.

## Current code
- [Pricing engine](../../api/src/lunar_margin/engine/pricing.py) implements a model `fixed + public-reference cost_per_kg × mass × destination_factor × demand_factor`. Its factors and price range are scenario assumptions, **not supplier contracts**.
- [Provider pricing](../../api/src/lunar_margin/engine/provider_pricing.py) distinguishes published terms from unknown mission schedule, spare capacity, destination coverage and pricing.
- [API contract](../api.md) specifies fields and uncertainty semantics.
- The 5×5 date grid aggregates modeled prices across qualifying 500 m candidate samples; it is **not** a reservation quote or lowest-cost feasible confirmed route.
- Terrain slope is a screening proxy only. It cannot resolve final landing risk or provider costs at meter scale.

## Required distinctions in the UI
1. **Published historical price / tariff:** cite supplier document, date, included service scope, and units.
2. **Modeled estimate:** show formula, assumptions and sensitivity.
3. **Quote / confirmed capacity:** display only if supported by verified commercial supplier information (not currently present).
4. **Unknown:** do not invent an estimate when it would be misleading.

## What the early model does not price
Actual provider bids; ride-share compatibility; integrated payload acceptance and margins; launch site and trajectory targeting; insurance; qualification; thermal/electrical integration; delivery-specific payload operations; export/licensing; lunar surface deconfliction.

## Reference
- [Astrobotic Lander Payload User Guide — historical public material](https://www.astrobotic.com/wp-content/uploads/2022/01/PUGLanders_011222.pdf)
- [NASA CLPS](https://www.nasa.gov/commercial-lunar-payload-services/)
- [NASA Inspector General reports](https://oig.nasa.gov/)

Use **Cost Sensitivity / Scenario Estimate** rather than "flight ticket price" or "booking."
