import { z } from 'zod'

/**
 * Where a body sits in an asset's local sky, and whether the terrain horizon clears it.
 * Mirrors one sample of `series` from `GET /analysis/earth-visibility`:
 * `visible` is the API's own verdict (`body_elevation_deg > horizon(body_azimuth_deg)`).
 */
export interface SkyDirection {
  /** Degrees clockwise from north, as the analysis API reports topocentric azimuth. */
  azimuthDeg: number
  /** Degrees above the local horizontal. */
  elevationDeg: number
  visible: boolean
}

const SkyDirectionSchema = z.object({
  azimuthDeg: z.number().finite(),
  elevationDeg: z.number().min(-90).max(90),
  visible: z.boolean(),
})

/** Validates one sky direction taken from an analysis response. Throws on invalid input. */
export function parseSkyDirection(input: unknown): SkyDirection {
  return SkyDirectionSchema.parse(input)
}

const RAD_PER_DEG = Math.PI / 180

/**
 * East-north-up offset in metres of a ray `lengthM` long pointing at `direction`.
 * Used to draw the line of sight from an asset toward the Earth; the length is a
 * display choice, not a distance to the body.
 */
export function rayOffsetEnu(
  direction: Pick<SkyDirection, 'azimuthDeg' | 'elevationDeg'>,
  lengthM: number,
): readonly [number, number, number] {
  const azimuth = direction.azimuthDeg * RAD_PER_DEG
  const elevation = direction.elevationDeg * RAD_PER_DEG
  const horizontal = Math.cos(elevation) * lengthM
  return [
    horizontal * Math.sin(azimuth),
    horizontal * Math.cos(azimuth),
    Math.sin(elevation) * lengthM,
  ]
}
