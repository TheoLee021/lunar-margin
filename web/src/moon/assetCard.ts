import { sightMarginDeg, type SkyDirection } from './lineOfSight'

export interface AssetCardInput {
  label: string
  /** Height of the point that has to see the Earth, metres above the surface. */
  observerHeightM: number
  earth: SkyDirection | null
  /** The Sun at the same point: power, where the Earth is comms. */
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
): string[] {
  if (direction === undefined) return []
  if (direction === null) return [`${name} 가시성 계산 전`]
  const margin = sightMarginDeg(direction)
  return [
    direction.visible
      ? `${name} 보임 · 여유 ${degrees(margin)}`
      : `${name} 차폐 · ${degrees(Math.abs(margin))} 모자람`,
    `  고도 ${degrees(direction.elevationDeg)} / 지평선 ${degrees(direction.horizonDeg)}`,
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
}: AssetCardInput): string {
  return [
    label,
    ...bodyLines('지구', earth),
    ...bodyLines('태양', sun),
    `관측 높이 ${metres(observerHeightM)}`,
  ].join('\n')
}
