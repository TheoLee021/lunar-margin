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

/** A square in the same metre-based south-polar projection as the candidate engine. */
export interface PolarGridCell {
  x_m: number
  y_m: number
  spacing_m: number
}

/** Four real grid corners, rather than a latitude/longitude bounding rectangle. */
export function gridCellCorners(cell: PolarGridCell): LunarLocation[] {
  const { x_m, y_m, spacing_m } = cell
  if (![x_m, y_m, spacing_m].every(Number.isFinite) || spacing_m <= 0)
    throw new Error(
      'Grid coordinates must be finite and spacing must be positive',
    )
  const half = spacing_m / 2
  return [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ].map(([dx, dy]) => {
    const x = x_m + dx!,
      y = y_m + dy!
    return {
      lat:
        -90 + 2 * Math.atan(Math.hypot(x, y) / (2 * 1_737_400)) * DEG_PER_RAD,
      lon: wrapLongitude(Math.atan2(x, y) * DEG_PER_RAD),
    }
  })
}
