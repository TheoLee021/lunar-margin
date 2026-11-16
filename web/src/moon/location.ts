/** A point on the lunar surface: planetocentric latitude/longitude in degrees, MOON_ME frame, east-positive. */
export interface LunarLocation {
  lat: number
  lon: number
  /** Height of the picked 3D tile surface above the lunar reference sphere. */
  surfaceHeightM?: number
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

const RAD_PER_DEG = Math.PI / 180

/** Reference sphere the analysis API and the DEM use (docs/api.md). */
export const MOON_RADIUS_M = 1_737_400

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
  // Rotate the local ENU displacement into the origin meridian frame.
  // This form keeps the east component even when cos(latitude) vanishes.
  const east = Math.sin(angular) * Math.sin(bearing)
  const north = Math.sin(angular) * Math.cos(bearing)
  const radial = Math.cos(angular)
  const x = radial * Math.cos(lat) - north * Math.sin(lat)
  const z = radial * Math.sin(lat) + north * Math.cos(lat)
  const nextLat = Math.atan2(z, Math.hypot(x, east))
  const nextLon = lon + Math.atan2(east, x)
  return {
    lat: nextLat * DEG_PER_RAD,
    lon: wrapLongitude(nextLon * DEG_PER_RAD),
  }
}
