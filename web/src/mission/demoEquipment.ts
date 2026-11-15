import type { AssetModel, AssetShape, MoonAsset } from '../moon/assetLayer'
import type { AssetSymbol } from '../moon/assetSymbol'
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
  /** Where it stands. For a mobile unit this is the start of its drive. */
  offset: SurfaceOffset
  /** Height of the point that has to see the Earth (the API's `observer_height_m`). */
  observerHeightM: number
  shape: AssetShape
  /** Drawn in place of `shape` when the unit has a model file. */
  model?: AssetModel
  /** Badge drawn above the unit so it is recognisable from a distance. */
  symbol: AssetSymbol
}

export interface MobileUnit {
  spec: EquipmentSpec
  /** Real driving speed. Earth round-trip latency is what holds these to a crawl. */
  speedMS: number
  /** The route, starting at the unit's own offset. */
  path: readonly SurfaceOffset[]
}

export interface Company {
  id: string
  name: string
  /** What the company sells, in its own words. */
  tagline: string
  statics: readonly EquipmentSpec[]
  mobile?: MobileUnit
}

/**
 * rover.glb measured from its own bounding box with the scale stored inside the file
 * applied: 12.71 m from wheels to mast top, with the origin 4.18 m above the lowest
 * point. Both numbers scale together, so a unit only has to say how tall it really is.
 */
const ROVER_HEIGHT_M = 12.7079
const ROVER_BELOW_ORIGIN_M = 4.1836
function roverModel(targetHeightM: number): AssetModel {
  const scale = targetHeightM / ROVER_HEIGHT_M
  return {
    uri: '/models/rover.glb',
    scale,
    baseLiftM: ROVER_BELOW_ORIGIN_M * scale,
  }
}

const box = (widthM: number, depthM: number, heightM: number): AssetShape => ({
  kind: 'box',
  widthM,
  depthM,
  heightM,
})
const drum = (diameterM: number, heightM: number): AssetShape => ({
  kind: 'cylinder',
  widthM: diameterM,
  depthM: diameterM,
  heightM,
})

// Dimensions and observer heights are the deployed figures from the equipment spec
// sheet. Offsets are ours: cable runs and stand-off distances spread a site over a few
// hundred metres, which is also what makes the units tell apart on screen.
export const COMPANIES: readonly Company[] = [
  {
    id: 'terra-nova-works',
    name: 'Terra Nova Works',
    tagline: '레골리스를 녹여 착륙장을 짓는다',
    statics: [
      {
        id: 'array',
        label: '태양광 어레이',
        offset: { eastM: -250, northM: 180 },
        observerHeightM: 10,
        shape: box(8, 2.2, 8),
        symbol: 'solar',
      },
      {
        id: 'thermal',
        label: '열제어 유닛',
        offset: { eastM: -60, northM: 60 },
        observerHeightM: 4,
        shape: box(3, 1.8, 1.4),
        symbol: 'thermal',
      },
      {
        id: 'printer',
        label: '소결 프린터',
        offset: { eastM: 160, northM: -120 },
        observerHeightM: 1.5,
        shape: box(6, 6, 4.5),
        symbol: 'printer',
      },
    ],
    mobile: {
      spec: {
        id: 'trencher',
        label: '트렌처',
        offset: { eastM: 300, northM: -260 },
        observerHeightM: 2,
        shape: box(2, 4.8, 2.4),
        model: roverModel(2.4),
        symbol: 'trencher',
      },
      speedMS: 0.2,
      path: [
        { eastM: 300, northM: -260 },
        { eastM: 340, northM: -360 },
        { eastM: 360, northM: -470 },
        { eastM: 350, northM: -580 },
        { eastM: 320, northM: -680 },
        { eastM: 270, northM: -760 },
        { eastM: 200, northM: -820 },
        { eastM: 120, northM: -860 },
      ],
    },
  },
  {
    id: 'meridian-relay',
    name: 'Meridian Relay',
    tagline: '지구 직통 통신 시간을 판다',
    statics: [
      {
        id: 'antenna-a',
        label: 'DTE 안테나 A',
        offset: { eastM: -180, northM: 140 },
        observerHeightM: 3,
        shape: box(1.6, 1.6, 3),
        symbol: 'antenna',
      },
      {
        id: 'antenna-b',
        label: 'DTE 안테나 B',
        offset: { eastM: 210, northM: 90 },
        observerHeightM: 3,
        shape: box(1.6, 1.6, 3),
        symbol: 'antenna',
      },
      {
        id: 'power-unit',
        label: '전력 조절 유닛',
        offset: { eastM: 20, northM: -60 },
        observerHeightM: 1.5,
        shape: box(1, 1.4, 1),
        symbol: 'power',
      },
    ],
  },
  {
    id: 'helios-grid',
    name: 'Helios Grid',
    tagline: '수직 태양광을 세우고 전력을 판다',
    statics: [
      {
        id: 'array',
        label: '수직 태양광 어레이',
        offset: { eastM: -140, northM: 160 },
        observerHeightM: 10,
        shape: box(10, 2.4, 10),
        symbol: 'solar',
      },
      {
        id: 'pdu',
        label: '배전 유닛',
        offset: { eastM: 40, northM: -70 },
        observerHeightM: 2,
        shape: drum(1.4, 1.2),
        symbol: 'power',
      },
    ],
  },
  {
    id: 'vestige-resources',
    name: 'Vestige Resources',
    tagline: '영구 음영 분화구 안으로 들어간다',
    statics: [
      {
        id: 'base',
        label: '충전 기지',
        offset: { eastM: -90, northM: 140 },
        observerHeightM: 1.5,
        shape: box(5, 2, 6),
        symbol: 'base',
      },
    ],
    mobile: {
      spec: {
        id: 'rover',
        label: '시추 로버',
        offset: { eastM: 60, northM: 60 },
        observerHeightM: 1.5,
        shape: box(1.5, 2.6, 2.2),
        model: roverModel(2.2),
        symbol: 'rover',
      },
      speedMS: 0.25,
      path: [
        { eastM: 60, northM: 60 },
        { eastM: 160, northM: -40 },
        { eastM: 250, northM: -170 },
        { eastM: 300, northM: -320 },
        { eastM: 300, northM: -480 },
        { eastM: 250, northM: -620 },
        { eastM: 160, northM: -730 },
        { eastM: 40, northM: -790 },
      ],
    },
  },
  {
    id: 'umbra-compute',
    name: 'Umbra Compute',
    tagline: '달 위의 데이터센터',
    statics: [
      {
        id: 'array',
        label: '태양광 어레이',
        offset: { eastM: -230, northM: 170 },
        observerHeightM: 10,
        shape: box(10, 2.4, 10),
        symbol: 'solar',
      },
      {
        id: 'compute',
        label: '연산 모듈',
        offset: { eastM: 0, northM: 0 },
        observerHeightM: 1,
        shape: box(1.8, 2.4, 2),
        symbol: 'compute',
      },
      {
        id: 'radiator',
        label: '방열판',
        offset: { eastM: 190, northM: -150 },
        observerHeightM: 0.5,
        shape: box(6, 2.8, 3),
        symbol: 'radiator',
      },
      {
        id: 'antenna',
        label: 'DTE 안테나',
        offset: { eastM: -50, northM: -210 },
        observerHeightM: 4,
        shape: box(1.6, 1.6, 4),
        symbol: 'antenna',
      },
    ],
  },
  {
    id: 'cairn-geophysics',
    name: 'Cairn Geophysics',
    tagline: '지하에 무엇이 있는지 측정해 판다',
    statics: [
      {
        id: 'hub',
        label: '전력·데이터 허브',
        offset: { eastM: 0, northM: 0 },
        observerHeightM: 1.5,
        shape: box(3.5, 1.8, 4),
        symbol: 'power',
      },
      {
        id: 'seis-a',
        label: '지진계 A',
        offset: { eastM: -420, northM: 260 },
        observerHeightM: 0.4,
        shape: box(1.2, 1.2, 0.4),
        symbol: 'seismic',
      },
      {
        id: 'seis-b',
        label: '지진계 B',
        offset: { eastM: 400, northM: 300 },
        observerHeightM: 0.4,
        shape: box(1.2, 1.2, 0.4),
        symbol: 'seismic',
      },
      {
        id: 'seis-c',
        label: '지진계 C',
        offset: { eastM: -70, northM: -470 },
        observerHeightM: 0.4,
        shape: box(1.2, 1.2, 0.4),
        symbol: 'seismic',
      },
      {
        id: 'drill',
        label: '열류 시추기',
        offset: { eastM: 140, northM: -100 },
        observerHeightM: 0.6,
        shape: drum(1.6, 2.2),
        symbol: 'drill',
      },
      {
        id: 'magnetometer',
        label: '자력계 마스트',
        offset: { eastM: -190, northM: 70 },
        observerHeightM: 3,
        shape: drum(0.6, 3),
        symbol: 'sensor',
      },
    ],
  },
]

export const DEFAULT_COMPANY_ID = COMPANIES[0]!.id

export function companyById(id: string): Company {
  return COMPANIES.find((company) => company.id === id) ?? COMPANIES[0]!
}

/** Every place that needs its own Earth verdict: the static units, then the route. */
export function sampledPlaces(
  company: Company,
): readonly { offset: SurfaceOffset; observerHeightM: number }[] {
  const statics = company.statics.map((spec) => ({
    offset: spec.offset,
    observerHeightM: spec.observerHeightM,
  }))
  const route = (company.mobile?.path ?? []).map((offset) => ({
    offset,
    observerHeightM: company.mobile!.spec.observerHeightM,
  }))
  return [...statics, ...route]
}

const legLength = (from: SurfaceOffset, to: SurfaceOffset): number =>
  Math.hypot(to.eastM - from.eastM, to.northM - from.northM)

export function pathLength(path: readonly SurfaceOffset[]): number {
  return path.reduce(
    (total, point, index) =>
      index === 0 ? 0 : total + legLength(path[index - 1]!, point),
    0,
  )
}

/** The drive is replayed faster than real time so it fits in a demo. */
export const DEMO_SPEED_SCALE = 150

export function driveDurationMs(mobile: MobileUnit): number {
  return (pathLength(mobile.path) / mobile.speedMS / DEMO_SPEED_SCALE) * 1000
}

export interface TraversePoint {
  offset: SurfaceOffset
  /** Index of the waypoint whose measured sky applies here. */
  waypoint: number
  /** Direction of travel, degrees clockwise from north. */
  headingDeg: number
}

/** Bearing of a leg, degrees clockwise from north. */
function bearingOf(from: SurfaceOffset, to: SurfaceOffset): number {
  const degrees =
    (Math.atan2(to.eastM - from.eastM, to.northM - from.northM) * 180) / Math.PI
  return (degrees + 360) % 360
}

/** Where a unit is after `progress` (0..1) of its route, at constant speed. */
export function traverseAt(
  path: readonly SurfaceOffset[],
  progress: number,
): TraversePoint {
  const clamped = Math.min(1, Math.max(0, progress))
  const last = path.length - 1
  const end = {
    offset: path[last]!,
    waypoint: last,
    headingDeg: last > 0 ? bearingOf(path[last - 1]!, path[last]!) : 0,
  }
  // Subtracting leg by leg leaves a rounding crumb, so land the end exactly.
  if (clamped === 1 || path.length < 2) return end
  let remaining = clamped * pathLength(path)
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]!
    const to = path[index]!
    const leg = legLength(from, to)
    if (remaining < leg) {
      const fraction = leg === 0 ? 0 : remaining / leg
      return {
        offset: {
          eastM: from.eastM + (to.eastM - from.eastM) * fraction,
          northM: from.northM + (to.northM - from.northM) * fraction,
        },
        waypoint: index - 1,
        headingDeg: bearingOf(from, to),
      }
    }
    remaining -= leg
  }
  return end
}

/** Measured Earth directions: one per static unit by id, one per route waypoint. */
export interface EquipmentSky {
  statics: Readonly<Record<string, SkyDirection | null>>
  waypoints: readonly (SkyDirection | null)[]
}

/** The drawable set for a candidate, with the mobile unit `progress` (0..1) along its route. */
export function buildEquipmentAssets(
  company: Company,
  site: CandidateSite,
  progress: number,
  sky: EquipmentSky,
): MoonAsset[] {
  const centre = { lat: site.latitude, lon: site.longitude }
  const place = (
    spec: EquipmentSpec,
    offset: SurfaceOffset,
    earth: SkyDirection | null,
    headingDeg?: number,
  ): MoonAsset => ({
    id: spec.id,
    label: spec.label,
    location: offsetLocation(centre, offset.eastM, offset.northM),
    observerHeightM: spec.observerHeightM,
    shape: spec.shape,
    ...(spec.model ? { model: spec.model } : {}),
    ...(headingDeg === undefined ? {} : { headingDeg }),
    symbol: spec.symbol,
    earth,
  })
  const drawn = company.statics.map((spec) =>
    place(spec, spec.offset, sky.statics[spec.id] ?? null),
  )
  const { mobile } = company
  if (mobile) {
    const point = traverseAt(mobile.path, progress)
    drawn.push(
      place(
        mobile.spec,
        point.offset,
        sky.waypoints[point.waypoint] ?? null,
        point.headingDeg,
      ),
    )
  }
  return drawn
}
