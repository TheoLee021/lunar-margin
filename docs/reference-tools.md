# JPL Horizons reference link — minimal interoperability

**Scope:** one feature: open JPL Horizons reference tables for the selected lunar candidate and landing date. This PR does **not** fetch Horizons data into Lunar Margin, compare numerical outputs, or modify the SPICE/LOLA engine.

- Sun: `COMMAND='10'`; Earth: `COMMAND='399'`.
- Observer: `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='east_longitude,latitude,0'`.
- Period: UTC landing midnight through the following UTC midnight, step 2 h.
- `QUANTITIES='4'` provides azimuth/elevation relative to the local reference horizon.
- The requested height is 0 km, which **does not** account for the selected candidate's DEM elevation or antenna height.
- Horizons' lunar figure / frame and apparent-geometric conventions must be reconciled with our MOON_ME / SPICE LT+S assumptions before reporting angular error statistics.
- Local reference-horizon azimuth/elevation is **not** terrain-clipped illumination or a validated RF communications link.

## Future work

Separate PR: real numerical ephemeris comparison and documented angular residuals with matching position, frame, epoch, correction convention, and elevation. No verification is claimed in this reference-link feature.

## Official documentation

- [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [JPL Horizons observing-site conventions](https://ssd.jpl.nasa.gov/horizons/manual.html)
