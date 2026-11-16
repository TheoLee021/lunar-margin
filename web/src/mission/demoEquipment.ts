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

/**
 * What the spec sheet says about where a unit may stand. Five of the six run power
 * down a cable, so everything they land has to sit within reach of the power unit.
 * The seismic array is the inverse: its stations locate events by comparing arrival
 * times, so a short baseline gives a poor fix and they must be far apart.
 *
 * These are the only placement facts the spec gives. The metre offsets below are ours,
 * and the tests check them against these limits rather than against nothing.
 */
export type Placement =
  | { kind: 'cable'; powerUnitId: string; cableLengthM: number }
  | { kind: 'spread'; between: readonly string[]; minSeparationM: number }

export interface Company {
  id: string
  name: string
  /** What the company sells, in its own words. */
  tagline: string
  statics: readonly EquipmentSpec[]
  mobile?: MobileUnit
  placement: Placement
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

const WHEEL = '#1f2937'
const CUTTER = '#f0a43c'
const PANEL = '#38509c'
const FRAME = '#94a3b8'

/**
 * A vertical solar array: a mast off a small base carrying two panel wings. Near the
 * pole the Sun stays on the horizon, which is why these stand up rather than lie flat.
 */
const solarArray = (widthM: number, heightM: number): AssetShape => ({
  kind: 'box',
  widthM,
  depthM: 2.4,
  heightM,
  parts: [
    { kind: 'box', widthM: 1.6, depthM: 1.6, heightM: 0.4, upM: 0.2 },
    {
      kind: 'cylinder',
      widthM: 0.4,
      depthM: 0.4,
      heightM: heightM * 0.6,
      upM: heightM * 0.3,
      cssColor: FRAME,
    },
    ...[-1, 1].map((side) => ({
      kind: 'box' as const,
      widthM: widthM / 2 - 0.2,
      depthM: 0.12,
      heightM: heightM * 0.45,
      acrossM: (side * widthM) / 4,
      upM: heightM * 0.72,
      cssColor: PANEL,
    })),
  ],
})

/** A dish on a mast. The dish is drawn as a flat disc, which reads at these sizes. */
const dishMast = (heightM: number): AssetShape => ({
  kind: 'box',
  widthM: 1.6,
  depthM: 1.6,
  heightM,
  parts: [
    { kind: 'box', widthM: 1, depthM: 1, heightM: 0.3, upM: 0.15 },
    {
      kind: 'cylinder',
      widthM: 0.3,
      depthM: 0.3,
      heightM: heightM * 0.8,
      upM: heightM * 0.4,
      cssColor: FRAME,
    },
    {
      kind: 'cylinder',
      widthM: 1.4,
      depthM: 1.4,
      heightM: 0.25,
      upM: heightM * 0.9,
    },
  ],
})

/**
 * The trencher, built from its parts rather than borrowed from the rover model: it is
 * a 4.8 x 2.0 m digging machine with a boom out front, and the rover file is a tall
 * narrow prospector. Drawing them the same made the two moving units indistinguishable.
 * `alongM` runs the way it drives, so the boom leads and the blade clears in front.
 */
const TRENCHER_SHAPE: AssetShape = {
  kind: 'box',
  widthM: 2,
  depthM: 4.8,
  heightM: 2.4,
  parts: [
    { kind: 'box', widthM: 1.8, depthM: 3.2, heightM: 1, upM: 0.9 },
    {
      kind: 'box',
      widthM: 0.5,
      depthM: 1.8,
      heightM: 0.35,
      alongM: 2.1,
      upM: 0.95,
    },
    {
      kind: 'cylinder',
      widthM: 1.2,
      depthM: 1.2,
      heightM: 0.45,
      alongM: 2.9,
      upM: 0.55,
      cssColor: CUTTER,
    },
    {
      kind: 'box',
      widthM: 2,
      depthM: 0.25,
      heightM: 0.6,
      alongM: 2.4,
      upM: 0.3,
    },
    {
      kind: 'cylinder',
      widthM: 0.16,
      depthM: 0.16,
      heightM: 1.4,
      alongM: -1,
      upM: 1.7,
    },
    ...[-1.1, 1.1].flatMap((alongM) =>
      [-0.95, 0.95].map((acrossM) => ({
        kind: 'box' as const,
        widthM: 0.35,
        depthM: 0.8,
        heightM: 0.8,
        acrossM,
        alongM,
        upM: 0.4,
        cssColor: WHEEL,
      })),
    ),
  ],
}

// Dimensions and observer heights are the deployed figures from the equipment spec
// sheet. Offsets are ours: cable runs and stand-off distances spread a site over a few
// hundred metres, which is also what makes the units tell apart on screen.
export const COMPANIES: readonly Company[] = [
  {
    id: 'terra-nova-works',
    placement: { kind: 'cable', powerUnitId: 'array', cableLengthM: 500 },
    name: 'Terra Nova Works',
    tagline: 'Melts regolith to build landing pads',
    statics: [
      {
        id: 'array',
        label: 'Solar array',
        offset: { eastM: -250, northM: 180 },
        observerHeightM: 10,
        shape: solarArray(8, 8),
        symbol: 'solar',
      },
      {
        id: 'thermal',
        label: 'Thermal control unit',
        offset: { eastM: -60, northM: 60 },
        observerHeightM: 4,
        shape: box(3, 1.8, 1.4),
        symbol: 'thermal',
      },
      {
        id: 'printer',
        label: 'Sintering printer',
        offset: { eastM: 140, northM: -100 },
        observerHeightM: 1.5,
        shape: {
          kind: 'box',
          widthM: 6,
          depthM: 6,
          heightM: 4.5,
          // A spider gantry: four legs, a body between them and an arm that sweeps
          // the laser head over the patch it is sintering.
          parts: [
            { kind: 'box', widthM: 2.4, depthM: 2.4, heightM: 1.2, upM: 3 },
            { kind: 'box', widthM: 5.6, depthM: 0.4, heightM: 0.3, upM: 3.8 },
            ...[-1, 1].flatMap((x) =>
              [-1, 1].map((y) => ({
                kind: 'cylinder' as const,
                widthM: 0.3,
                depthM: 0.3,
                heightM: 3.2,
                acrossM: x * 2.4,
                alongM: y * 2.4,
                upM: 1.6,
                cssColor: FRAME,
              })),
            ),
          ],
        },
        symbol: 'printer',
      },
    ],
    mobile: {
      spec: {
        id: 'trencher',
        label: 'Trencher',
        offset: { eastM: -70, northM: 360 },
        observerHeightM: 2,
        shape: TRENCHER_SHAPE,
        symbol: 'trencher',
      },
      speedMS: 0.2,
      path: [
        { eastM: -70, northM: 360 },
        { eastM: -30, northM: 260 },
        { eastM: -10, northM: 150 },
        { eastM: -20, northM: 40 },
        { eastM: -50, northM: -60 },
        { eastM: -100, northM: -140 },
        { eastM: -170, northM: -200 },
        { eastM: -250, northM: -240 },
      ],
    },
  },
  {
    id: 'meridian-relay',
    placement: { kind: 'cable', powerUnitId: 'power-unit', cableLengthM: 400 },
    name: 'Meridian Relay',
    tagline: 'Sells direct-to-Earth link time',
    statics: [
      {
        id: 'antenna-a',
        label: 'DTE antenna A',
        offset: { eastM: -180, northM: 140 },
        observerHeightM: 3,
        shape: dishMast(3),
        symbol: 'antenna',
      },
      {
        id: 'antenna-b',
        label: 'DTE antenna B',
        offset: { eastM: 210, northM: 90 },
        observerHeightM: 3,
        shape: dishMast(3),
        symbol: 'antenna',
      },
      {
        id: 'power-unit',
        label: 'Power conditioning unit',
        offset: { eastM: 20, northM: -60 },
        observerHeightM: 1.5,
        shape: box(1, 1.4, 1),
        symbol: 'power',
      },
    ],
  },
  {
    id: 'helios-grid',
    placement: { kind: 'cable', powerUnitId: 'array', cableLengthM: 1000 },
    name: 'Helios Grid',
    tagline: 'Raises vertical solar arrays and sells power',
    statics: [
      {
        id: 'array',
        label: 'Vertical solar array',
        offset: { eastM: -140, northM: 160 },
        observerHeightM: 10,
        shape: solarArray(10, 10),
        symbol: 'solar',
      },
      {
        id: 'pdu',
        label: 'Power distribution unit',
        offset: { eastM: 40, northM: -70 },
        observerHeightM: 2,
        shape: drum(1.4, 1.2),
        symbol: 'power',
      },
    ],
  },
  {
    id: 'vestige-resources',
    placement: { kind: 'cable', powerUnitId: 'base', cableLengthM: 200 },
    name: 'Vestige Resources',
    tagline: 'Goes into permanently shadowed craters',
    statics: [
      {
        id: 'base',
        label: 'Charging base',
        offset: { eastM: -90, northM: 140 },
        observerHeightM: 1.5,
        shape: {
          kind: 'box',
          widthM: 5,
          depthM: 2,
          heightM: 6,
          // A single panel wing on a mast, with the dock the rover parks in below.
          parts: [
            { kind: 'box', widthM: 1.8, depthM: 1.8, heightM: 0.5, upM: 0.25 },
            {
              kind: 'cylinder',
              widthM: 0.4,
              depthM: 0.4,
              heightM: 3.6,
              upM: 1.8,
              cssColor: FRAME,
            },
            {
              kind: 'box',
              widthM: 4.6,
              depthM: 0.15,
              heightM: 2.4,
              upM: 4.4,
              cssColor: PANEL,
            },
            {
              kind: 'box',
              widthM: 1.6,
              depthM: 1.6,
              heightM: 0.4,
              alongM: 1.6,
              upM: 0.2,
            },
          ],
        },
        symbol: 'base',
      },
    ],
    mobile: {
      spec: {
        id: 'rover',
        label: 'Drill rover',
        offset: { eastM: -62, northM: 125 },
        observerHeightM: 1.5,
        shape: box(1.5, 2.6, 2.2),
        // Original metre-scale glTF, grounded at the wheels. Cesium maps its
        // forward axis to east; align it with the route's north-zero bearing.
        model: {
          uri: '/models/rover.glb',
          scale: 1,
          baseLiftM: 0,
          headingOffsetDeg: -90,
        },
        symbol: 'rover',
      },
      speedMS: 0.25,
      path: [
        { eastM: -62, northM: 125 },
        { eastM: -42, northM: 106 },
        { eastM: -25, northM: 81 },
        { eastM: -16, northM: 53 },
        { eastM: -16, northM: 22 },
        { eastM: -25, northM: -4 },
        { eastM: -42, northM: -25 },
        { eastM: -65, northM: -37 },
      ],
    },
  },
  {
    id: 'umbra-compute',
    placement: { kind: 'cable', powerUnitId: 'array', cableLengthM: 600 },
    name: 'Umbra Compute',
    tagline: 'A data centre on the Moon',
    statics: [
      {
        id: 'array',
        label: 'Solar array',
        offset: { eastM: -230, northM: 170 },
        observerHeightM: 10,
        shape: solarArray(10, 10),
        symbol: 'solar',
      },
      {
        id: 'compute',
        label: 'Compute module',
        offset: { eastM: 0, northM: 0 },
        observerHeightM: 1,
        shape: box(1.8, 2.4, 2),
        symbol: 'compute',
      },
      {
        id: 'radiator',
        label: 'Radiator',
        offset: { eastM: 190, northM: -150 },
        observerHeightM: 0.5,
        shape: {
          kind: 'box',
          widthM: 6,
          depthM: 2.8,
          heightM: 3,
          // Panels stood up on a low frame, facing cold sky rather than lit ground.
          parts: [
            { kind: 'box', widthM: 6, depthM: 2.4, heightM: 0.3, upM: 0.15 },
            ...[-2, 0, 2].map((acrossM) => ({
              kind: 'box' as const,
              widthM: 1.6,
              depthM: 0.12,
              heightM: 2.4,
              acrossM,
              upM: 1.5,
              cssColor: FRAME,
            })),
          ],
        },
        symbol: 'radiator',
      },
      {
        id: 'antenna',
        label: 'DTE antenna',
        offset: { eastM: -50, northM: -210 },
        observerHeightM: 4,
        shape: dishMast(4),
        symbol: 'antenna',
      },
    ],
  },
  {
    id: 'cairn-geophysics',
    placement: {
      kind: 'spread',
      between: ['seis-a', 'seis-b', 'seis-c'],
      minSeparationM: 800,
    },
    name: 'Cairn Geophysics',
    tagline: 'Measures what lies underground and sells the data',
    statics: [
      {
        id: 'hub',
        label: 'Power and data hub',
        offset: { eastM: 0, northM: 0 },
        observerHeightM: 1.5,
        shape: box(3.5, 1.8, 4),
        symbol: 'power',
      },
      {
        id: 'seis-a',
        label: 'Seismometer A',
        offset: { eastM: -420, northM: 260 },
        observerHeightM: 0.4,
        shape: box(1.2, 1.2, 0.4),
        symbol: 'seismic',
      },
      {
        id: 'seis-b',
        label: 'Seismometer B',
        offset: { eastM: 400, northM: 300 },
        observerHeightM: 0.4,
        shape: box(1.2, 1.2, 0.4),
        symbol: 'seismic',
      },
      {
        id: 'seis-c',
        label: 'Seismometer C',
        offset: { eastM: -70, northM: -470 },
        observerHeightM: 0.4,
        shape: box(1.2, 1.2, 0.4),
        symbol: 'seismic',
      },
      {
        id: 'drill',
        label: 'Heat-flow drill',
        offset: { eastM: 140, northM: -100 },
        observerHeightM: 0.6,
        shape: drum(1.6, 2.2),
        symbol: 'drill',
      },
      {
        id: 'magnetometer',
        label: 'Magnetometer mast',
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
export function sampledPlaces(company: Company) {
  const statics = company.statics.map((spec) => ({
    unitId: spec.id,
    offset: spec.offset,
    observerHeightM: spec.observerHeightM,
  }))
  const route = (company.mobile?.path ?? []).map((offset, waypoint) => ({
    waypoint,
    offset,
    observerHeightM: company.mobile!.spec.observerHeightM,
  }))
  return [...statics, ...route]
}

export function pathLength(path: readonly SurfaceOffset[]): number {
  return path.reduce(
    (total, point, index) =>
      index === 0 ? 0 : total + offsetDistanceM(path[index - 1]!, point),
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
    const leg = offsetDistanceM(from, to)
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

/** What was measured at one place: the Earth for comms, the Sun for power. */
export interface PlaceSky {
  earth: SkyDirection | null
  sun: SkyDirection | null
}

/** One reading per static unit by id, and one per route waypoint. */
export interface EquipmentSky {
  statics: Readonly<Record<string, PlaceSky>>
  waypoints: readonly PlaceSky[]
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
    measured: PlaceSky | undefined,
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
    waypointSample: headingDeg !== undefined,
    measured: measured !== undefined,
    earth: measured?.earth ?? null,
    sun: measured?.sun ?? null,
  })
  const drawn = company.statics.map((spec) =>
    place(spec, spec.offset, sky.statics[spec.id]),
  )
  const { mobile } = company
  if (mobile) {
    const point = traverseAt(mobile.path, progress)
    // Transport the route heading into the unit's local north/east frame.
    const radians = Math.PI / 180
    const here = offsetLocation(centre, point.offset.eastM, point.offset.northM)
    const forward = offsetLocation(
      centre,
      point.offset.eastM + Math.sin(point.headingDeg * radians),
      point.offset.northM + Math.cos(point.headingDeg * radians),
    )
    const dLon = (forward.lon - here.lon) * radians
    const lat = here.lat * radians
    const nextLat = forward.lat * radians
    const localHeading =
      Math.atan2(
        Math.sin(dLon) * Math.cos(nextLat),
        Math.cos(lat) * Math.sin(nextLat) -
          Math.sin(lat) * Math.cos(nextLat) * Math.cos(dLon),
      ) / radians
    drawn.push(
      place(
        mobile.spec,
        point.offset,
        sky.waypoints[point.waypoint],
        localHeading,
      ),
    )
  }
  return drawn
}

/** Planar distance between two offsets, metres. Over a few hundred metres that is exact enough. */
export function offsetDistanceM(a: SurfaceOffset, b: SurfaceOffset): number {
  return Math.hypot(a.eastM - b.eastM, a.northM - b.northM)
}
