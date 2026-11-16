import { describe, expect, it } from 'vitest'
import {
  COMPANIES,
  offsetDistanceM,
  buildEquipmentAssets,
  companyById,
  driveDurationMs,
  pathLength,
  sampledPlaces,
  traverseAt,
} from './demoEquipment'
import type { CandidateSite } from './types'

const SITE: CandidateSite = {
  id: 'site-1',
  name: '후보 1',
  latitude: -89.83,
  longitude: -153.7,
}
const CLEAR = {
  azimuthDeg: 212.4,
  elevationDeg: 0.7,
  horizonDeg: 0.2,
  visible: true,
}
const BLOCKED = {
  azimuthDeg: 212.4,
  elevationDeg: -0.4,
  horizonDeg: 0.9,
  visible: false,
}
const TERRA = companyById('terra-nova-works')
const MERIDIAN = companyById('meridian-relay')
const TRENCH = TERRA.mobile!.path
const unmeasured = { earth: null, sun: null }
const noSky = {
  statics: {},
  waypoints: TRENCH.map(() => unmeasured),
}

describe('COMPANIES', () => {
  it('gives every unit a real height and an observer point on it', () => {
    for (const company of COMPANIES)
      for (const spec of [
        ...company.statics,
        ...(company.mobile ? [company.mobile.spec] : []),
      ]) {
        expect(spec.shape.heightM).toBeGreaterThan(0)
        expect(spec.observerHeightM).toBeGreaterThan(0)
      }
  })

  it('keeps unit ids unique inside a company, since the scene keys on them', () => {
    for (const company of COMPANIES) {
      const ids = [
        ...company.statics.map((spec) => spec.id),
        ...(company.mobile ? [company.mobile.spec.id] : []),
      ]
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('starts a route at the unit that drives it', () => {
    for (const company of COMPANIES)
      if (company.mobile)
        expect(company.mobile.path[0]).toEqual(company.mobile.spec.offset)
  })

  it('falls back to the first company for an unknown id', () => {
    expect(companyById('no-such-company')).toBe(COMPANIES[0])
  })
})

describe('placement against the spec sheet', () => {
  it('keeps every cable-fed unit within reach of its power unit', () => {
    for (const company of COMPANIES) {
      if (company.placement.kind !== 'cable') continue
      const { powerUnitId, cableLengthM } = company.placement
      const power = company.statics.find((spec) => spec.id === powerUnitId)
      expect(power, `${company.id} has no ${powerUnitId}`).toBeDefined()
      for (const spec of company.statics) {
        if (spec.id === powerUnitId) continue
        const run = offsetDistanceM(spec.offset, power!.offset)
        expect(
          run,
          `${company.id}/${spec.id} is ${run.toFixed(0)} m from power, over ${cableLengthM} m`,
        ).toBeLessThanOrEqual(cableLengthM)
      }
    }
  })

  it('spreads the seismic stations past the baseline they need', () => {
    for (const company of COMPANIES) {
      if (company.placement.kind !== 'spread') continue
      const { between, minSeparationM } = company.placement
      const placed = between.map((id) => {
        const spec = company.statics.find((candidate) => candidate.id === id)
        expect(spec, `${company.id} has no ${id}`).toBeDefined()
        return spec!
      })
      for (let i = 0; i < placed.length; i += 1)
        for (let j = i + 1; j < placed.length; j += 1) {
          const gap = offsetDistanceM(placed[i]!.offset, placed[j]!.offset)
          expect(
            gap,
            `${placed[i]!.id} and ${placed[j]!.id} are ${gap.toFixed(0)} m apart, under ${minSeparationM} m`,
          ).toBeGreaterThanOrEqual(minSeparationM)
        }
    }
  })
})

describe('sampledPlaces', () => {
  it('asks for one place per static unit and one per waypoint', () => {
    expect(sampledPlaces(TERRA)).toHaveLength(
      TERRA.statics.length + TRENCH.length,
    )
    expect(sampledPlaces(MERIDIAN)).toHaveLength(MERIDIAN.statics.length)
  })

  it('samples each place at the observer height of its own unit', () => {
    const places = sampledPlaces(MERIDIAN)
    expect(places.map((place) => place.observerHeightM)).toEqual(
      MERIDIAN.statics.map((spec) => spec.observerHeightM),
    )
  })
})

describe('traverseAt', () => {
  it('starts on the first waypoint', () => {
    expect(traverseAt(TRENCH, 0)).toMatchObject({
      offset: TRENCH[0],
      waypoint: 0,
    })
  })

  it('ends on the last waypoint', () => {
    expect(traverseAt(TRENCH, 1)).toMatchObject({
      offset: TRENCH.at(-1),
      waypoint: TRENCH.length - 1,
    })
  })

  it('clamps progress outside 0..1', () => {
    expect(traverseAt(TRENCH, -3)).toEqual(traverseAt(TRENCH, 0))
    expect(traverseAt(TRENCH, 9)).toEqual(traverseAt(TRENCH, 1))
  })

  it('interpolates inside a segment at constant speed', () => {
    const half = traverseAt(TRENCH, 0.5)
    expect(half.offset).not.toEqual(TRENCH[0])
    expect(half.offset).not.toEqual(TRENCH.at(-1))
    let walked = 0
    for (let i = 1; i <= half.waypoint; i += 1)
      walked += Math.hypot(
        TRENCH[i]!.eastM - TRENCH[i - 1]!.eastM,
        TRENCH[i]!.northM - TRENCH[i - 1]!.northM,
      )
    walked += Math.hypot(
      half.offset.eastM - TRENCH[half.waypoint]!.eastM,
      half.offset.northM - TRENCH[half.waypoint]!.northM,
    )
    expect(walked).toBeCloseTo(pathLength(TRENCH) / 2, 6)
  })

  it('faces the way it is driving', () => {
    // The trench starts heading south-east: east grows, north falls.
    const start = traverseAt(TRENCH, 0).headingDeg
    expect(start).toBeGreaterThan(90)
    expect(start).toBeLessThan(180)
    // It curves back west by the end, so the bearing passes south.
    expect(traverseAt(TRENCH, 1).headingDeg).toBeGreaterThan(180)
  })
})

describe('driveDurationMs', () => {
  it('is the route at the real speed, played back faster', () => {
    const mobile = TERRA.mobile!
    expect(driveDurationMs(mobile)).toBeCloseTo(
      (pathLength(mobile.path) / mobile.speedMS / 150) * 1000,
      6,
    )
  })
})

describe('buildEquipmentAssets', () => {
  it('draws every unit of the chosen company', () => {
    expect(
      buildEquipmentAssets(TERRA, SITE, 0, noSky).map((a) => a.id),
    ).toEqual(['array', 'thermal', 'printer', 'trencher'])
    expect(
      buildEquipmentAssets(MERIDIAN, SITE, 0, {
        statics: {},
        waypoints: [],
      }).map((a) => a.id),
    ).toEqual(['antenna-a', 'antenna-b', 'power-unit'])
  })

  it('keeps the units within about a kilometre of the site', () => {
    for (const company of COMPANIES)
      for (const asset of buildEquipmentAssets(company, SITE, 0, noSky))
        expect(Math.abs(asset.location.lat - SITE.latitude)).toBeLessThan(0.05)
  })

  it('sizes each unit from its real dimensions', () => {
    const [array] = buildEquipmentAssets(TERRA, SITE, 0, noSky)
    expect(array?.shape.heightM).toBe(8)
    expect(array?.observerHeightM).toBe(10)
  })

  it('moves only the mobile unit as the drive runs', () => {
    const at = (progress: number) =>
      Object.fromEntries(
        buildEquipmentAssets(TERRA, SITE, progress, noSky).map((a) => [
          a.id,
          JSON.stringify(a.location),
        ]),
      )
    const before = at(0),
      after = at(1)
    expect(after['array']).toBe(before['array'])
    expect(after['printer']).toBe(before['printer'])
    expect(after['trencher']).not.toBe(before['trencher'])
  })

  it('gives the mobile unit the sky of the waypoint it is on', () => {
    const waypoints = TRENCH.map((_, index) => ({
      earth: index === 0 ? CLEAR : BLOCKED,
      sun: null,
    }))
    expect(
      buildEquipmentAssets(TERRA, SITE, 0, { statics: {}, waypoints }).at(-1)
        ?.earth,
    ).toEqual(CLEAR)
    expect(
      buildEquipmentAssets(TERRA, SITE, 1, { statics: {}, waypoints }).at(-1)
        ?.earth,
    ).toEqual(BLOCKED)
  })

  it('gives each static unit its own sky and leaves the rest unevaluated', () => {
    const assets = buildEquipmentAssets(TERRA, SITE, 0, {
      statics: { array: { earth: CLEAR, sun: null } },
      waypoints: TRENCH.map(() => unmeasured),
    })
    expect(assets[0]?.earth).toEqual(CLEAR)
    expect(assets[1]?.earth).toBeNull()
  })
})

it('keeps the full mobile route inside its power cable radius', () => {
  for (const operator of COMPANIES) {
    if (!operator.mobile || operator.placement.kind !== 'cable') continue
    const { powerUnitId, cableLengthM } = operator.placement
    const supply = operator.statics.find((unit) => unit.id === powerUnitId)!
    for (const point of operator.mobile.path)
      expect(offsetDistanceM(point, supply.offset)).toBeLessThanOrEqual(
        cableLengthM,
      )
  }
})
