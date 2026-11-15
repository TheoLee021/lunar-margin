import { describe, expect, it } from 'vitest'
import {
  TRAVERSE,
  TRAVERSE_LENGTH_M,
  buildEquipmentAssets,
  traverseAt,
} from './demoEquipment'
import type { CandidateSite } from './types'

const SITE: CandidateSite = {
  id: 'site-1',
  name: '후보 1',
  latitude: -89.83,
  longitude: -153.7,
}
const CLEAR = { azimuthDeg: 212.4, elevationDeg: 0.7, visible: true }
const BLOCKED = { azimuthDeg: 212.4, elevationDeg: -0.4, visible: false }
const noSky = { statics: {}, waypoints: TRAVERSE.map(() => null) }

describe('traverseAt', () => {
  it('starts on the first waypoint', () => {
    expect(traverseAt(0)).toMatchObject({ offset: TRAVERSE[0], waypoint: 0 })
  })

  it('ends on the last waypoint', () => {
    expect(traverseAt(1)).toMatchObject({
      offset: TRAVERSE.at(-1),
      waypoint: TRAVERSE.length - 1,
    })
  })

  it('faces the way it is driving', () => {
    // The trench starts heading south-east: east grows, north falls.
    const start = traverseAt(0).headingDeg
    expect(start).toBeGreaterThan(90)
    expect(start).toBeLessThan(180)
    // It curves back west by the end, so the bearing passes south.
    expect(traverseAt(1).headingDeg).toBeGreaterThan(180)
  })

  it('clamps progress outside 0..1', () => {
    expect(traverseAt(-3)).toEqual(traverseAt(0))
    expect(traverseAt(9)).toEqual(traverseAt(1))
  })

  it('interpolates inside a segment at constant speed', () => {
    const half = traverseAt(0.5)
    const first = TRAVERSE[0]!
    const last = TRAVERSE.at(-1)!
    // Halfway along the path, so not sitting on either end.
    expect(half.offset).not.toEqual(first)
    expect(half.offset).not.toEqual(last)
    // Distance walked from the start is half the path length, within a metre.
    let walked = 0
    for (let i = 1; i <= half.waypoint; i += 1)
      walked += Math.hypot(
        TRAVERSE[i]!.eastM - TRAVERSE[i - 1]!.eastM,
        TRAVERSE[i]!.northM - TRAVERSE[i - 1]!.northM,
      )
    walked += Math.hypot(
      half.offset.eastM - TRAVERSE[half.waypoint]!.eastM,
      half.offset.northM - TRAVERSE[half.waypoint]!.northM,
    )
    expect(walked).toBeCloseTo(TRAVERSE_LENGTH_M / 2, 6)
  })

  it('reports the waypoint the leg started from', () => {
    expect(traverseAt(0.5).waypoint).toBeLessThan(TRAVERSE.length - 1)
  })
})

describe('buildEquipmentAssets', () => {
  it('places every unit of the set', () => {
    const assets = buildEquipmentAssets(SITE, 0, noSky)
    expect(assets.map((asset) => asset.id)).toEqual([
      'array',
      'thermal',
      'printer',
      'trencher',
    ])
  })

  it('keeps the units within about a kilometre of the site', () => {
    // 0.05 deg is 1.5 km on the Moon. The set spreads over a few hundred metres
    // because cable runs and stand-off distances put it there, not metres apart.
    for (const asset of buildEquipmentAssets(SITE, 0, noSky)) {
      expect(Math.abs(asset.location.lat - SITE.latitude)).toBeLessThan(0.05)
    }
  })

  it('sizes each unit from its real dimensions', () => {
    const [array] = buildEquipmentAssets(SITE, 0, noSky)
    expect(array?.shape.heightM).toBe(8)
    expect(array?.observerHeightM).toBe(10)
  })

  it('moves only the trencher as the traverse runs', () => {
    const start = buildEquipmentAssets(SITE, 0, noSky)
    const end = buildEquipmentAssets(SITE, 1, noSky)
    const at = (assets: readonly { id: string; location: unknown }[]) =>
      Object.fromEntries(assets.map((a) => [a.id, JSON.stringify(a.location)]))
    const before = at(start)
    const after = at(end)
    expect(after['array']).toBe(before['array'])
    expect(after['printer']).toBe(before['printer'])
    expect(after['trencher']).not.toBe(before['trencher'])
  })

  it('gives the trencher the sky of the waypoint it is on', () => {
    const waypoints = TRAVERSE.map((_, index) =>
      index === 0 ? CLEAR : BLOCKED,
    )
    const assets = buildEquipmentAssets(SITE, 0, { statics: {}, waypoints })
    expect(assets.at(-1)?.earth).toEqual(CLEAR)
    const later = buildEquipmentAssets(SITE, 1, { statics: {}, waypoints })
    expect(later.at(-1)?.earth).toEqual(BLOCKED)
  })

  it('gives each static unit its own sky and leaves the rest unevaluated', () => {
    const assets = buildEquipmentAssets(SITE, 0, {
      statics: { array: CLEAR },
      waypoints: TRAVERSE.map(() => null),
    })
    expect(assets[0]?.earth).toEqual(CLEAR)
    expect(assets[1]?.earth).toBeNull()
  })
})
