# TOP 5 candidate comparison

The mission dashboard keeps its saved TOP 5 ranking. Check any of those candidates,
then open **선택 후보 비교** to compare up to five in a modal. Checking a candidate
does not select or move the map, request point analysis, or alter the ranking.
Two or three candidates are easier to read; all five remain available.

The comparison uses one saved run, surface interval and search observer height.
Refreshing the same saved result keeps the checks.
Changing the landing date, duration or loaded run clears the checks. Changing the
live viewshed height does not change these saved metrics. Closing the modal keeps
the checks; **비교 선택 모두 해제** clears them.

## Six axes

| Axis                      | Outward direction | Display range                                    |
| ------------------------- | ----------------- | ------------------------------------------------ |
| Sun visibility            | Higher            | 0–100%                                           |
| Longest darkness          | Lower             | 0–full surface interval in hours                 |
| Minimum RF link margin    | Higher            | −30 to +30 dB                                           |
| Longest Earth occultation | Lower             | 0–full surface interval in hours                 |
| Regional slope P95        | Lower             | 0–positive saved slope limit; otherwise 15°      |
| Regional roughness P95    | Lower             | 0–positive saved roughness limit; otherwise 20 m |

Ranges depend on the saved mission, never on which candidates are checked. The
15°/20 m fallbacks are display references, not NASA thresholds or landing-safety
limits. Zero limits remain zero in the requirements table and use the display
fallback to avoid division by zero. Values outside a display range are clipped
only in the radar; the original values remain visible in the table.

Missing values are shown as **—**. Terrain with less than 99.99% valid coverage is
unavailable for comparison, including its requirement margin. Missing vertices
and adjoining edges are omitted; the polygon is not closed across missing data.

The actual-value table retains units. The requirement table reuses the existing
saved-limit margin calculation: value minus minimum, or maximum minus value.
Positive margins are inside the limit; percentage differences use percentage
points. These are nominal differences, not quantified uncertainty bounds.

RF link margin uses the minimum modeled link margin across the mission interval and is unavailable when RF was not evaluated. Longest Earth occultation uses Earth-center geometric LOS. For
RF searches, the separate requirement table shows the saved nominal RF conditions
alongside the radar. No new eligibility verdict,
aggregate score, science value, safety certification or success probability is
calculated. Radar area has no decision meaning.

## Decision rationale

NASA's [Decision Analysis guidance](https://www.nasa.gov/reference/6-8-decision-analysis/)
distinguishes mandatory requirements from enhancing criteria and asks for explicit
criteria, assumptions and limitations. NASA's published
[south-pole site-selection analysis](https://ntrs.nasa.gov/citations/20250011660)
also considers combined calendar-dependent constraints and robustness across
mission epochs. This UI helps inspect trade-offs among already ranked candidates;
it does not implement NASA's full mission selection process or a date-robustness
analysis.

## Validation

- `cd web && npm run check`: lint, format, strict TypeScript, unit tests and build.
- `cd web && npm run e2e -- e2e/site-comparison.spec.ts --workers=1`: checks,
  unchanged physical scales, actual values/margins, run/date reset, incomplete
  terrain, mobile modal and all-five rendering. Uses the existing synthetic API
  fixture on port 8765 and a Vite proxy to that API; not independent NASA-data
  validation.
- The comparison adds no dependencies, backend endpoints or Cesium selection
  changes. Existing full real-backend E2E remains a separate merge check.
