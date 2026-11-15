import type { AssetShape, MoonAsset } from '../moon/assetLayer'
import type { SkyDirection } from '../moon/lineOfSight'
import { offsetLocation } from '../moon/location'
import type { CandidateSite } from './types'

/** A place on the surface as metres east and north of a candidate's centre. */
export interface SurfaceOffset {
  eastM: number
  northM: number
}

export interface EquipmentSpec {
  id: string
  label: string
  /** Where it stands. For the trencher this is the start of its traverse. */
  offset: SurfaceOffset
  /** Height of the point that has to see the Earth (the API's `observer_height_m`). */
  observerHeightM: number
  shape: AssetShape
}

// Terra Nova Works melts regolith into landing pads: an array for power, a thermal unit
// on the cable run, a sintering printer at the pad, and a trencher that drives.
// Dimensions and observer heights are the deployed figures from the equipment spec sheet.
export const STATIC_EQUIPMENT: readonly EquipmentSpec[] = [
  {
    id: 'array',
    label: '태양광 어레이',
    offset: { eastM: -60, northM: 40 },
    observerHeightM: 10,
    shape: { kind: 'box', widthM: 8, depthM: 2.2, heightM: 8 },
  },
  {
    id: 'thermal',
    label: '열제어 유닛',
    offset: { eastM: -20, northM: 10 },
    observerHeightM: 4,
    shape: { kind: 'box', widthM: 3, depthM: 1.8, heightM: 1.4 },
  },
  {
    id: 'printer',
    label: '소결 프린터',
    offset: { eastM: 30, northM: -20 },
    observerHeightM: 1.5,
    shape: { kind: 'box', widthM: 6, depthM: 6, heightM: 4.5 },
  },
]

export const TRENCHER: EquipmentSpec = {
  id: 'trencher',
  label: '트렌처',
  offset: { eastM: 60, northM: -60 },
  observerHeightM: 2,
  shape: { kind: 'box', widthM: 2, depthM: 4.8, heightM: 2.4 },
}

/** The trench the trencher cuts, away from the pad toward the crater edge. */
export const TRAVERSE: readonly SurfaceOffset[] = [
  { eastM: 60, northM: -60 },
  { eastM: 90, northM: -90 },
  { eastM: 120, northM: -120 },
  { eastM: 140, northM: -160 },
  { eastM: 150, northM: -200 },
  { eastM: 140, northM: -240 },
  { eastM: 110, northM: -270 },
  { eastM: 70, northM: -290 },
]

const legLength = (from: SurfaceOffset, to: SurfaceOffset): number =>
  Math.hypot(to.eastM - from.eastM, to.northM - from.northM)

export const TRAVERSE_LENGTH_M: number = TRAVERSE.reduce(
  (total, point, index) =>
    index === 0 ? 0 : total + legLength(TRAVERSE[index - 1]!, point),
  0,
)

/** Real driving speed. Earth round-trip latency is what holds it to a walking crawl. */
export const TRENCHER_SPEED_MS = 0.2
/** The traverse is replayed faster than real time so it fits in a demo. */
export const DEMO_SPEED_SCALE = 60
export const TRAVERSE_DURATION_MS =
  (TRAVERSE_LENGTH_M / TRENCHER_SPEED_MS / DEMO_SPEED_SCALE) * 1000

export interface TraversePoint {
  offset: SurfaceOffset
  /** Index of the waypoint whose measured sky applies here. */
  waypoint: number
}

/** Where the trencher is after `progress` (0..1) of the trench, at constant speed. */
export function traverseAt(progress: number): TraversePoint {
  const clamped = Math.min(1, Math.max(0, progress))
  // Subtracting leg by leg leaves a rounding crumb, so land the end exactly.
  if (clamped === 1)
    return { offset: TRAVERSE.at(-1)!, waypoint: TRAVERSE.length - 1 }
  let remaining = clamped * TRAVERSE_LENGTH_M
  for (let index = 1; index < TRAVERSE.length; index += 1) {
    const from = TRAVERSE[index - 1]!
    const to = TRAVERSE[index]!
    const leg = legLength(from, to)
    if (remaining < leg) {
      const fraction = leg === 0 ? 0 : remaining / leg
      return {
        offset: {
          eastM: from.eastM + (to.eastM - from.eastM) * fraction,
          northM: from.northM + (to.northM - from.northM) * fraction,
        },
        waypoint: index - 1,
      }
    }
    remaining -= leg
  }
  return { offset: TRAVERSE.at(-1)!, waypoint: TRAVERSE.length - 1 }
}

/** Measured Earth directions: one per static unit by id, one per traverse waypoint. */
export interface EquipmentSky {
  statics: Readonly<Record<string, SkyDirection | null>>
  waypoints: readonly (SkyDirection | null)[]
}

/** The drawable set for a candidate, with the trencher `progress` (0..1) along its trench. */
export function buildEquipmentAssets(
  site: CandidateSite,
  progress: number,
  sky: EquipmentSky,
): MoonAsset[] {
  const centre = { lat: site.latitude, lon: site.longitude }
  const place = (
    spec: EquipmentSpec,
    offset: SurfaceOffset,
    earth: SkyDirection | null,
  ): MoonAsset => ({
    id: spec.id,
    label: spec.label,
    location: offsetLocation(centre, offset.eastM, offset.northM),
    observerHeightM: spec.observerHeightM,
    shape: spec.shape,
    earth,
  })
  const point = traverseAt(progress)
  return [
    ...STATIC_EQUIPMENT.map((spec) =>
      place(spec, spec.offset, sky.statics[spec.id] ?? null),
    ),
    place(TRENCHER, point.offset, sky.waypoints[point.waypoint] ?? null),
  ]
}
