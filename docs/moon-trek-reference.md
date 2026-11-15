# NASA Moon Trek: External Map Reference

**One feature:** a single external NASA Moon Trek entry point in the selected candidate's mission panel, accompanied by the selected site's latitude and east longitude.

This small integration does **not** fetch or embed Moon Trek WMTS map tiles in the Cesium Moon 3D Tiles viewer. It does not claim a coordinate deep link, automatic site selection, numerical validation, or any change to NASA LOLA/SPICE calculations. The user manually looks up the displayed coordinates in Moon Trek.

- Official viewer: https://trek.nasa.gov/moon/
- Public WMTS interface (future work, separate PR): https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon

## Manual verification

1. Open Lunar Margin, select a saved-run candidate.
2. Confirm the displayed site latitude and normalized east longitude match the candidate coordinates.
3. Click **Open NASA Moon Trek** and confirm the official viewer opens in a separate tab.
4. Manually locate the site. No equivalence of map projection, relief or pixels should be claimed without a separate coordinate-system and tile-integration verification.

This PR is intentionally independent from the Horizons-reference PR and changes no back-end scientific or commercial model.
