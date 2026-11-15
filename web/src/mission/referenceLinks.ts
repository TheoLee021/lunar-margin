/** URLs for independently inspecting a candidate with official NASA/JPL tools. */
export type ReferenceSite = {
  latitude: number
  longitude: number
  landing: string
}

export function siteCoordinates(site: Pick<ReferenceSite, 'latitude' | 'longitude'>): string {
  const east = ((site.longitude % 360) + 360) % 360
  return `Latitude: ${site.latitude.toFixed(5)}°, Longitude: ${east.toFixed(5)}° E`
}

export function horizonsReferenceUrl(site: ReferenceSite, body: 'sun' | 'earth'): string {
  if (
    !Number.isFinite(site.latitude) ||
    site.latitude < -90 ||
    site.latitude > 90 ||
    !Number.isFinite(site.longitude) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(site.landing)
  ) {
    throw new Error('Invalid lunar site or landing date')
  }

  const start = new Date(`${site.landing}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== site.landing) {
    throw new Error('Invalid landing date')
  }
  const end = new Date(start.getTime() + 86_400_000)
  const east = ((site.longitude % 360) + 360) % 360

  const params = new URLSearchParams({
    format: 'text',
    COMMAND: body === 'sun' ? "'10'" : "'399'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${east.toFixed(6)},${site.latitude.toFixed(6)},0'`,
    START_TIME: `'${site.landing}'`,
    STOP_TIME: `'${end.toISOString().slice(0, 10)}'`,
    STEP_SIZE: "'2 h'",
    QUANTITIES: "'4'",
    ANG_FORMAT: "'DEG'",
    APPARENT: "'AIRLESS'",
    CSV_FORMAT: "'YES'",
    TIME_TYPE: "'UT'",
  })
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${params.toString()}`
}

/** The stable entry point is used until Moon Trek's share-link hash is verified. */
export const MOON_TREK_URL = 'https://trek.nasa.gov/moon/'
export const MOON_TREK_WMTS_DOCS = 'https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon'
