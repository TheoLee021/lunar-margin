/** A point on the lunar surface: planetocentric latitude/longitude in degrees, MOON_ME frame, east-positive. */
export interface LunarLocation {
  lat: number
  lon: number
}

/** Cesium Cartographic shape (radians), kept structural so this module stays free of Cesium. */
export interface CartographicRadians {
  latitude: number
  longitude: number
}

const DEG_PER_RAD = 180 / Math.PI
const RAD_PER_DEG = Math.PI / 180

/** Reference sphere the analysis API and the DEM use (docs/api.md). */
export const MOON_RADIUS_M = 1_737_400

export function toLunarLocation({
  latitude,
  longitude,
}: CartographicRadians): LunarLocation {
  return {
    lat: latitude * DEG_PER_RAD,
    lon: wrapLongitude(longitude * DEG_PER_RAD),
  }
}

function wrapLongitude(lonDeg: number): number {
  const wrapped = ((((lonDeg + 180) % 360) + 360) % 360) - 180
  return wrapped
}

/**
 * The point `eastM` east and `northM` north of `origin`, in metres along the surface.
 * Walks a great circle rather than scaling degrees, so it stays correct at the south pole
 * where a few hundred metres east is most of a degree of longitude.
 */
export function offsetLocation(
  origin: LunarLocation,
  eastM: number,
  northM: number,
): LunarLocation {
  const distance = Math.hypot(eastM, northM)
  if (distance === 0) return { lat: origin.lat, lon: origin.lon }
  const angular = distance / MOON_RADIUS_M
  const bearing = Math.atan2(eastM, northM)
  const lat = origin.lat * RAD_PER_DEG
  const lon = origin.lon * RAD_PER_DEG
  const sinLat =
    Math.sin(lat) * Math.cos(angular) +
    Math.cos(lat) * Math.sin(angular) * Math.cos(bearing)
  const nextLat = Math.asin(Math.min(1, Math.max(-1, sinLat)))
  const nextLon =
    lon +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
      Math.cos(angular) - Math.sin(lat) * sinLat,
    )
  return {
    lat: nextLat * DEG_PER_RAD,
    lon: wrapLongitude(nextLon * DEG_PER_RAD),
  }
}
