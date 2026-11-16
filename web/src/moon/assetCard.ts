import { sightMarginDeg, type SkyDirection } from './lineOfSight'

export interface AssetCardInput {
  label: string
  /** Height of the point that has to see the Earth, metres above the surface. */
  observerHeightM: number
  earth: SkyDirection | null
  /** The Sun at the same point: power, where the Earth is comms. */
  measured?: boolean
  waypointSample?: boolean
  sun?: SkyDirection | null
}

const metres = (value: number): string =>
  `${Number.isInteger(value) ? value : value.toFixed(1)} m`
// Two places, because the margins that decide a site here are tenths of a degree, and
// units standing a few hundred metres apart differ only in the second place.
const degrees = (value: number): string => `${value.toFixed(2)}°`

function bodyLines(
  name: string,
  direction: SkyDirection | null | undefined,
  measured?: boolean,
): string[] {
  if (direction === undefined) return []
  if (direction === null)
    return [`${name} visibility ${measured ? 'failed' : 'pending'}`]
  const margin = sightMarginDeg(direction)
  const amount =
    Math.abs(margin) > 0 && Math.abs(margin) < 0.005
      ? '<0.01°'
      : degrees(Math.abs(margin))
  return [
    direction.visible
      ? `${name} visible · margin ${amount}`
      : `${name} blocked · short by ${amount}`,
    `  elevation ${degrees(direction.elevationDeg)} / horizon ${degrees(direction.horizonDeg)}`,
  ]
}

/**
 * The few lines a unit has to say for itself, drawn beside it in the scene.
 *
 * The margin is the line that decides something: a unit clearing the horizon by two
 * degrees is safe where one clearing it by a tenth is not, and the observer height
 * underneath explains why the unit next to it can disagree. The Sun is here for the
 * same reason the Earth is: one is whether it can talk, the other whether it can run.
 */
export function assetCardText({
  label,
  observerHeightM,
  earth,
  sun,
  measured,
  waypointSample,
}: AssetCardInput): string {
  return [
    label,
    ...(waypointSample ? ['At the latest waypoint'] : []),
    ...bodyLines('Earth', earth, measured),
    ...bodyLines('Sun', sun, measured),
    `Observer height ${metres(observerHeightM)}`,
  ].join('\n')
}
