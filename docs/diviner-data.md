# Diviner temperature acquisition

From `api/`, run `uv run python -m lunar_margin.pipeline.diviner` (optional
`--data-dir PATH`). This opt-in command downloads **one** reviewed south-polar
summer/local-time product into `DATA_DIR/diviner`, separate from DEM and SPICE.
The default `pipeline.fetch` command and application startup are unchanged.

## Official provenance (verified 2026-11-15)

- [NASA PDS Diviner entry](https://pds-geosciences.wustl.edu/missions/lro/diviner.htm)
  links the [PCP collection](https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_pcp/).
- Product: `pcp_avg_tbol_pols_sum_ltim01_240`, PDS4 version 1.0;
  LID `urn:nasa:pds:lro_diviner_derived1:data_derived_pcp:pcp_avg_tbol_pols_sum_ltim01_240`.
- [Official product directory](https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_pcp/diurnal/ltim/pols/)
  contains the `.tab`, migrated PDS3 `.lbl`, and PDS4 `.xml` metadata.
- `.tab`: **212,653,759 bytes** (~203 MiB), 59-byte header plus 3,604,300
  fixed 59-byte ASCII records. `.lbl`: 3,637 bytes. Both are downloaded;
  the official label is also retained as a base64 offline fixture (preserving CRLF bytes).
- Grid: 240 m, polar stereographic, nominal 80–90°S cap; empty bins omitted.
  Columns: normalized polar `x,y` (mean lunar radius 1737.4 km), east longitude,
  planetocentric latitude, average bolometric brightness temperature in **K**.
  These are sparse table rows, not a rectangular LOLA raster. The XML's latitude
  statistics extend slightly beyond the nominal boundary (-79.995227°).
- Season: southern summer (subsolar latitude < 0); local-time bin 00:00–00:15.
  Observations: 2009-07-05T16:50:26.195Z to 2019-02-17T00:00:00Z.
  PDS4 special constants: invalid `-9998`, unknown `-9999`; do not treat as kelvin.
- [PDS Geosciences usage FAQ](https://pds-geosciences.wustl.edu/faq.html):
  archived datasets are public domain and freely downloadable. Cite the dataset
  and Williams et al. (2019), DOI `10.1029/2019JE006028`; repository MIT licensing
  does not replace the source data's terms.

The existing `ensure_file` pipeline supplies streaming downloads, `.part`
handling and a local URL/size/SHA-256 manifest. This command additionally pins
both official SHA-256 values, checked against the
[official bundle MD5 inventory](https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/urn-nasa-pds-lro_diviner_derived1.md5)
(label `CF081A5D625C7C8D2BBEEEF64CA91AD7`, table `9A9984FECB319133ADBF673301D520B0`).
A changed label is rejected before requesting the table. Failed checksum files
are removed so a retry can download again; upstream revisions require review.
Cached files are also checked against the pins, not only the local manifest.

This is historical, seasonally accumulated **brightness temperature**, not a
landing-date forecast, full-night minimum/maximum, subsurface temperature, or
lander thermal survival calculation. No lat/lon lookup, resampling, prediction,
UI, API, ranking, descent (#69), RF or solar calculation is added here.
