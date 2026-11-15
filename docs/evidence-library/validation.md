# Validation & Evidence

**Status:** this document is a verification plan and a distinction of claims, not a certificate that these tests have all been completed.

## Verification ladder
| Claim | Verification needed | Currently demonstrable from code? |
| --- | --- | --- |
| Sun/Earth position | matching SPICE-Horizons site/epoch comparison, frame/azimuth/elevation conventions, residuals | SPICE calculations are implemented; independent numerical comparison must be recorded |
| Terrain horizon | independent sightline calculation or higher-resolution DEM comparison with coverage/height sensitivity | horizon calculation implemented; external error budget pending |
| Surface access window | numerical convergence with decreasing time step and event-boundary checks | algorithm implemented; report measured test values before claiming accuracy |
| Candidate search | fixed inputs, reproducible top K and hard threshold handling | implementation and tests documented in [candidate methodology](../candidates.md) |
| Flight trajectory | independent transfer benchmarks and perturbation sensitivity | preliminary model, **not flight-certified** |
| Economics | provenance, term-by-term costs, uncertainties and unknowns | scenario model, **not actual supplier quotes** |
| UX improvement | timed user tasks on Moon Trek/Horizons versus Lunar Margin, number of steps, participant count | benchmark not yet provided |

## Review protocol
Record input coordinates, mission dates, UTC boundaries, observer height, used kernels and DEM, resolution, model version/commit, raw results, error statistics and source URL. Preserve "not measured" instead of a fabricated zero.

## Data provenance
See [data manifest and metadata](../data.md). Large NASA DEMs and kernels are loaded by the backend and should not be committed into the public website repository or Google Drive.

## Submission packaging
- Space Apps: one public **demo** link (video ≤30 s **or** English slide deck ≤7 slides), plus public final project and required text fields.
- Mark what was built during the hackathon versus any earlier references or experiments.
- State limitations: geometric LOS ≠ communications link closure; light ≠ operational solar power; DEM screening ≠ certified safe landing; price estimate ≠ verified available fare.
- Public links must work without sign-in and must not reveal unpublished team material.
