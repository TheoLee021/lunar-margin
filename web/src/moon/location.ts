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
