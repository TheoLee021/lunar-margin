# Local landing-target terrain grid (experimental)

This optional analysis is **separate from the 500 m candidate discovery grid**.
It refines an already-selected point for coarse *terrain screening only*.

```text
500 m candidate centers (already in candidate search)
    ↓ select candidate
250 m radius local assessment grid (LOLA 80 m DEM, approximately 80 m sampling)
    ↓ evaluate many possible centers
50 m radius candidate target circles (terrain proxy, NOT 50 m terrain resolution)
    ↓
relative slope/roughness comparison + DEM coverage + UNVERIFIED status
```

## API

`GET /analysis/landing-grid?lat=-89.5&lon=222&max_slope_deg=10`

Query fields: `lat` (-90 to -80), `lon` (-360 to 360),
`assessment_radius_m` (160–500, default 250),
`target_radius_m` (20–100, default 50; must be smaller than the assessment radius),
`max_slope_deg` (0–90, default 10), and optional `max_roughness_m` (nonnegative).
Unknown fields or invalid input return HTTP 422. Missing LOLA DEM returns 503.

The response includes:
- `cells`: local DEM-sampled offsets, slope and detrended roughness, missing-data state;
- `targets`: evaluated target-circle centers, sample coverage, slope P95 / maximum,
  maximum roughness, screening condition and reasons;
- `best_target`: lowest-worst-slope passing center, or `null` if none pass;
- `total_target_centers`, `passing_target_centers` and sampling geometry;
- `landing_safety_status: "UNVERIFIED"` always.

## What a PASS does and does not mean

A target passes *the specified DEM proxy thresholds* if every sampled DEM cell
that intersects its nominal target disk has a complete terrain window and its
maximum local DEM slope is within the chosen threshold. If roughness limit is
supplied, maximum local roughness must also be within the limit. Unknown pixels
must not silently be replaced with flat terrain.

The cell support is conservatively approximated by a circumscribed circle
(half the square cell diagonal); this avoids checking only the cell whose center
lies in a 50 m target circle. This is a **coarse screen**, not actual coverage of
each feature inside the disk. Sampling finer than DEM resolution does not create
independent measurements.

Crucially: **a 50 m diameter/radius target is not resolved by an 80 m DEM**.
Neither a PASS nor the label "best" certifies boulder size, footpad or soil
bearing conditions, regolith/plume interactions, landing dispersion, or
landing-system safety. The result does not claim to identify a certified landing
ellipse. It is only a relative DEM-scale terrain hypothesis for follow-up.

The target-center ranking minimizes maximum DEM-scale slope, then roughness,
then distance from the nominated site. No physical weighting is claimed.

## UI

In candidate detail, click **250m 지형 격자 계산**. The request is
user-triggered to avoid a burst of DEM operations on the API host.
A small map shows valid/missing DEM cells and, if one exists, the
best coarse-screened target circle. The original candidate score and
Sun/Earth LOS results are unchanged.

## Relationship to the existing PR #11

This change is developed on a **separate branch based on PR #11** and does not
modify the reviewed PR #11 branch itself. It reuses the
`site_characteristics.py` slope/roughness conventions but does not replace
the existing 250 m regional-slope P95 filter or the 500 m discovery pipeline.
