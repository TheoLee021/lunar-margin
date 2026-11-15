import { z } from 'zod'
import type { LunarLocation } from './location'

/** Cartesian vector in the MOON_ME frame (Cesium world coordinates). */
export type Vector3 = readonly [number, number, number]

const SunDirectionSchema = z
  .tuple([z.number(), z.number(), z.number()])
  .refine(([x, y, z]) => Math.hypot(x, y, z) > 0, 'must not be a zero vector')

/** Validates a Moon-to-Sun direction (MOON_ME) and returns it as a unit vector. */
export function parseSunDirection(input: unknown): Vector3 {
  const [x, y, z] = SunDirectionSchema.parse(input)
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

const RAD = Math.PI / 180

/**
 * Sun direction in MOON_ME from its local azimuth/elevation at a surface point, as the analysis API
 * reports it (azimuth 0° = north, clockwise). The Sun is far enough away that this one vector holds
 * for the whole Moon.
 */
export function sunDirectionFromLocal(
  site: LunarLocation,
  azimuthDeg: number,
  elevationDeg: number,
): Vector3 {
  const lat = site.lat * RAD
  const lon = site.lon * RAD
  const az = azimuthDeg * RAD
  const el = elevationDeg * RAD
  const e = Math.cos(el) * Math.sin(az)
  const n = Math.cos(el) * Math.cos(az)
  const u = Math.sin(el)
  const [sinLat, cosLat, sinLon, cosLon] = [
    Math.sin(lat),
    Math.cos(lat),
    Math.sin(lon),
    Math.cos(lon),
  ]
  // east = (-sinλ, cosλ, 0), north = (-sinφ cosλ, -sinφ sinλ, cosφ), up = (cosφ cosλ, cosφ sinλ, sinφ)
  return [
    -sinLon * e - sinLat * cosLon * n + cosLat * cosLon * u,
    cosLon * e - sinLat * sinLon * n + cosLat * sinLon * u,
    cosLat * n + sinLat * u,
  ]
}
