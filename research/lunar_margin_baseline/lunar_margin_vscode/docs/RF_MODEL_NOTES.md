# RF model notes

This module is a **nominal DTE link-budget extension**, not the core Space Apps requirement.

Flow:

`terrain-aware Earth LOS -> FSPL -> received power -> link margin -> nominal RF availability`

Key distinctions:

- FSPL depends on distance and frequency, not on elevation angle or LOS itself.
- LOS is an upstream gate. If Earth is terrain-blocked, the DTE link is blocked.
- Elevation can matter through multipath, antenna patterns, and ground-station geometry, but those effects are outside this nominal MVP model unless explicitly added.
- The default `RFConfig` values preserve the team's early Colab assumptions and are not mission specifications.
- `rx_required_dbm` is not a universal ground-station constant. It depends on data rate, modulation, coding, receiver noise/performance, and implementation assumptions.
- Multipath/Rician fading, stochastic shadowing, residual Doppler, weather, and ground-station scheduling are outside the baseline unless separately modeled.
