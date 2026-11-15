# Mission Engineering — Requirements, Margins & Verification

**Status:** the HUD candidate panel shows a *screening* requirement matrix using recorded candidate and search conditions; it does not assert flight certification, mission success probability, or independent validation.

## Mission Engineering workflow
```text
Mission Question → Requirements → NASA/mission-model data → Measured metric
    → Margin / PASS-FAIL-UNKNOWN → Trade alternatives → Evidence & limitations
```

This PR adds a simple, traceable **single-site** requirements and margin panel to the selected candidate in the saved 500 m search result. An A/B comparison lives in a separate draft PR (#50) and must not be presented as part of this feature.

### Computation
For an upper-bounded constraint such as maximum darkness:
`margin = allowed_limit − observed_value`.
For a lower-bounded constraint such as minimum access fraction:
`margin = observed_value − required_minimum`.
`PASS` requires margin >= 0. A negative margin is `FAIL`; if the observation is missing then `UNKNOWN`; if no limit was specified that row is omitted. Overall summary fails if any requirement fails, remains unknown if any enabled metric is unknown, and passes only if all enabled metrics pass.

### Sources of truth and scope
- **Thresholds** come from `run.config.thresholds`, not fabricated lander performance specs.
- **Measurements** come from the saved candidate's `sun`, `earth`, `rf`, and `terrain` data. Different search runs or time windows are not mixed.
- When `run.config.rf` is set, communications screening uses saved **nominal RF** instead of geometric Earth LOS.
- Site slope and roughness are **region-scale DEM proxies**, not hazards verified at touchdown scale.
- The panel repeats already recorded search metrics and does **not** independently recompute Sun, Earth, RF, energy balance, landing dynamics or spacecraft operation.
- Source run ID and candidate ID are displayed; the report must also preserve run inputs, software version and data manifest.

### First reproducible experiment LM-001
1. Use one recorded mission run with known UTC start/end, 30-minute step, surface observer height, and thresholds.
2. Choose two candidates **from the same run** and record this matrix for each. A/B conclusions should be recorded in the separate decision report; do not mix it with this single-site widget.
3. Check which requirement dominates each candidate, including an UNKNOWN if the DEM lacks a value.
4. Sensitivity: re-run at differing DEM resolutions or observer heights. The present panel is **not** a sensitivity solver.
5. Record decision: selected option, rejected options, reasons, caveats, and the additional descent/landing engineering checks required.

### Critical scientific caveats
- Geometric sunlight ≠ generated energy or reliable power. Dark-hours limits must be traceable to an energy/thermal budget before being treated as real spacecraft requirements.
- Earth geometric LOS ≠ DTE link closure. The nominal RF model still omits ground-station schedules, atmosphere and detailed operating conditions.
- 80 m LOLA DEM and 500 m site grid ≠ a certified safe landing ellipse.
- Precomputed run scores and thresholds are conditional screening evidence; no validated mission success probability is implied.
