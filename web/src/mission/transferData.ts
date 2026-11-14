import { z } from 'zod'

const vector = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
])
const sample = z.object({
  seconds: z.number().finite().nonnegative(),
  spacecraft_km: vector,
  moon_km: vector,
})
export const TransferDataSchema = z
  .object({
    departure: z.iso.datetime({ offset: true }),
    arrival: z.iso.datetime({ offset: true }),
    model: z.string(),
    earth_radius_km: z.number().positive(),
    moon_radius_km: z.number().positive(),
    plane_x: vector,
    plane_y: vector,
    capture_plane_x: vector,
    capture_plane_y: vector,
    metrics: z.object({
      travel_time_days: z.number().positive(),
      parking_orbit_altitude_km: z.number().positive(),
      arrival_altitude_km: z.number().positive(),
      arrival_position_error_km: z.number().nonnegative().max(0.05),
      post_loi_min_altitude_km: z.number().positive(),
      tli_delta_v_km_s: z.number().positive(),
      loi_delta_v_km_s: z.number().positive(),
      total_impulsive_delta_v_km_s: z.number().positive(),
    }),
    transfer: z.array(sample).min(2),
    capture: z.array(sample).min(2),
    moon_orbit_km: z.array(vector).min(2),
  })
  .refine((data) => {
    const ordered = (samples: z.infer<typeof sample>[]) =>
      samples.every((s, i) => i === 0 || s.seconds > samples[i - 1]!.seconds)
    return (
      Math.abs(
        data.transfer.at(-1)!.seconds -
          (Date.parse(data.arrival) - Date.parse(data.departure)) / 1000,
      ) < 0.1 &&
      data.transfer[0]!.seconds === 0 &&
      ordered(data.transfer) &&
      ordered(data.capture) &&
      Math.abs(data.transfer.at(-1)!.seconds - data.capture[0]!.seconds) < 0.01
    )
  }, 'Invalid trajectory time sequence')

export type TransferData = z.infer<typeof TransferDataSchema>
export type OrbitSample = z.infer<typeof sample>
type Vector = z.infer<typeof vector>
export type Point = [number, number]

export function project(
  data: Pick<TransferData, 'plane_x' | 'plane_y'>,
  position: Vector,
): Point {
  const dot = (axis: Vector) =>
    position.reduce((sum, v, i) => sum + v * axis[i]!, 0)
  return [-dot(data.plane_x), dot(data.plane_y)]
}

export function relativePosition(sample: OrbitSample): Vector {
  return sample.spacecraft_km.map((v, i) => v - sample.moon_km[i]!) as Vector
}

// One common scale preserves the calculated geometry in both projections.
export function fitProjection(
  points: Point[],
  width: number,
  height: number,
  padding = 32,
) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  const minX = Math.min(...xs),
    maxX = Math.max(...xs)
  const minY = Math.min(...ys),
    maxY = Math.max(...ys)
  const scale = Math.min(
    (width - 2 * padding) / Math.max(maxX - minX, 1),
    (height - 2 * padding) / Math.max(maxY - minY, 1),
  )
  const at = ([x, y]: Point): Point => [
    width / 2 + (x - (minX + maxX) / 2) * scale,
    height / 2 - (y - (minY + maxY) / 2) * scale,
  ]
  return { at, scale }
}

export const pathOf = (points: Point[]) =>
  points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
