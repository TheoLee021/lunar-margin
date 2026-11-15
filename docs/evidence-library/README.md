# Lunar Margin — Research & Evidence Library

This folder is the reviewable evidence base for the Lunar Margin web application and NASA Space Apps 2026 submission. It is not a flight-certified landing tool, a commercial quote service, or an official NASA recommendation.

## Navigation
1. [Physics & Methods](physics.md) — datasets, calculation chain, coordinate/time conventions, surface visibility, orbital-model scope.
2. [Economics & Logistics](economics.md) — cost assumptions, provider data, commercial availability limitations.
3. [Scenarios & Forecasts](scenarios.md) — date delays, site change cases, and *explicitly speculative* 2027–2032 development scenarios.
4. [Validation & Evidence](validation.md) — evidence ladder, known assumptions, uncertainties, and a submission checklist.

## Existing technical sources of truth
- [NASA data catalog](../data.md): LOLA and JPL NAIF/SPICE inputs and versions.
- [Candidate search method](../candidates.md): 2 km → 500 m, filters, ranking, and outputs.
- [API contract](../api.md): exact semantics of user-facing results and prices.
- [Reservations policy](../reservations.md): modeled grid reservation; **not** legally recognized lunar site ownership.
- [Backend README](../../api/README.md): test and deployment instructions.
- [Repository README](../../README.md): current integrated capabilities and explicit non-capabilities.

## Evidence conventions
Every claim in the app or presentation should carry one of these labels:
- **Measured / computed** — derived by stated reproducible model and inputs; does not imply independent verification.
- **Validated** — compared with independent reference, including error and coverage.
- **Model estimate** — depends on stated assumptions and is not a live commercial quote.
- **Illustrative** — placeholder, UX illustration, or pedagogic scenario, not observed mission data.
- **Forecast** — a scenario, not confirmed contracts or actual infrastructure.
- **Unknown** — not enough data to calculate safely.

If a source changes, update the URL, accessed date, model assumptions, and test results. Never fill missing data with silent defaults or invented pricing.

## Future Google Drive mirror (not connected)
```text
Lunar Margin — Public Evidence/
  00_Submission_and_Demo/
  01_Physics_and_Methods/
  02_Economics_and_Logistics/
  03_Scenarios_and_Forecasts/
  04_Validation_and_Evidence/
  05_Data_Sources_and_Licenses/
Lunar Margin — Private Team Work/
  Drafts/
  Internal_Notes/
  Unpublished_Data/
```
Public Drive documents should link **to** the permanent canonical GitHub source documents where feasible. Link only folders/files explicitly shared publicly; never link internal or restricted UMBRA/SELFIE research notes. Do not include secret credentials, service-role keys, or unpublished third-party content.

Website: the app's **Research & Evidence** page links directly to the public canonical Markdown files. Drive can later be linked without changing the computational backend.
