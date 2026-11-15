# NASA Reference Tools — Minimum Interoperability

**Status:** external official references from a selected candidate; **not** in-app Horizons result ingestion, independent numeric validation, or Moon Trek WMTS image fusion.

## How to use
Open a saved mission run, select a candidate, and use the "NASA Reference Tools" section of the candidate detail panel.

### JPL Horizons
The Sun and Earth buttons construct an official [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) observer table request for **the selected lunar location** and **the selected landing date** (UTC midnight to the next midnight, sampled every 2 h).
- `COMMAND='10'` = Sun, `COMMAND='399'` = Earth.
- `CENTER='coord@301'` places the observer on the Moon.
- `COORD_TYPE='GEODETIC'`, `SITE_COORD='east-longitude,latitude,0'` (reference figure, height 0 **km**).
- `QUANTITIES='4'` = local apparent azimuth/elevation, `ANG_FORMAT='DEG'`, `APPARENT='AIRLESS'`.
- Results open on **JPL's website** as a text table. No browser CORS, third-party credentials, caching, or backend modifications are necessary.
- Site height is fixed to zero and **does not** incorporate the candidate DEM elevation or antenna height.
- Horizons' own lunar surface coordinate/frame convention must be reconciled with Lunar Margin's MOON_ME and SPICE LT+S setup **before** interpreting differences as ephemeris errors.
- Horizons gives angles relative to its local reference horizon, **not** the LOLA terrain horizon. The comparison is not an end-to-end validation of shadows, RF connectivity, or candidate suitability.

### NASA Moon Trek
The button opens [Moon Trek](https://trek.nasa.gov/moon/) and shows a copyable coordinate pair for **manual** site lookup. It does not claim an unverified coordinate-specific deep link.
The public [WMTS reference](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon) is linked for subsequent image-layer integration. Moon Trek's map tile projections and Cesium's Moon 3D Tiles require an explicit transformation/reprojection step before any direct overlay.

## Mission engineering next step
Choose LM-001 site/date, obtain Horizons outputs at matched observation times and conventions, and record angular residuals with date, kernel versions, reference elevation model, and uncertainty. The raw URLs are evidence pointers, not "VALIDATED" status.

## Sources
- [JPL Horizons API official manual](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [Horizons observing-site conventions](https://ssd.jpl.nasa.gov/horizons/manual.html)
- [NASA Moon Trek official viewer](https://trek.nasa.gov/moon/)
- [NASA Moon Trek WMTS documentation](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon)
