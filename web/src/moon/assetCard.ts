import { sightMarginDeg, type SkyDirection } from './lineOfSight'

export interface AssetCardInput {
  label: string
  /** Height of the point that has to see the Earth, metres above the surface. */
  observerHeightM: number
  earth: SkyDirection | null
}

const metres = (value: number): string =>
  `${Number.isInteger(value) ? value : value.toFixed(1)} m`
const degrees = (value: number): string => `${value.toFixed(1)}°`

/**
 * The few lines a unit has to say for itself, drawn beside it in the scene.
 *
 * The margin is the line that decides something: a unit clearing the horizon by two
 * degrees is safe where one clearing it by a tenth is not, and the observer height
 * underneath explains why the unit next to it can disagree.
 */
export function assetCardText({
  label,
  observerHeightM,
  earth,
}: AssetCardInput): string {
  const lines = [label]
  if (!earth) {
    lines.push('지구 가시성 계산 전')
  } else {
    const margin = sightMarginDeg(earth)
    lines.push(
      earth.visible
        ? `지구 보임 · 여유 ${degrees(margin)}`
        : `지구 차폐 · ${degrees(Math.abs(margin))} 모자람`,
    )
    lines.push(
      `고도 ${degrees(earth.elevationDeg)} / 지평선 ${degrees(earth.horizonDeg)}`,
    )
  }
  lines.push(`관측 높이 ${metres(observerHeightM)}`)
  return lines.join('\n')
}
