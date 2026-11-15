"""Shared constants and baseline site definitions."""

MOON_RADIUS_KM = 1737.4
MOON_RADIUS_M = MOON_RADIUS_KM * 1000.0
MOON_FRAME = "MOON_ME"

# Representative analysis points for three Artemis south-pole candidate regions.
# These are working analysis points, not certified landing ellipses.
SITES = {
    "Mons Mouton Plateau": {"lat_deg": -84.1, "lon_deg": 34.7},
    "Malapert Massif": {"lat_deg": -85.9, "lon_deg": 0.3},
    "de Gerlache Rim 2": {"lat_deg": -88.2, "lon_deg": 295.9},
}

# NASA PGDA south-pole LOLA COG discussed for the baseline.
# If remote /vsicurl access is unavailable in your environment, download the
# file locally and pass the local path to TerrainModel instead.
DEFAULT_DEM_URL = (
    "/vsicurl/https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
    "LDEM_80S_20MPP_ADJ.TIF"
)
