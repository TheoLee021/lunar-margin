import { z } from 'zod'

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
