import { describe, expect, it } from 'vitest'
import { parseSkyDirection, rayOffsetEnu, sightMarginDeg } from './lineOfSight'

const CLOSE = 1e-9

describe('rayOffsetEnu', () => {
  it('points north at azimuth 0', () => {
    const [east, north, up] = rayOffsetEnu(
      { azimuthDeg: 0, elevationDeg: 0 },
      1000,
    )
    expect(east).toBeCloseTo(0, 6)
    expect(north).toBeCloseTo(1000, 6)
    expect(up).toBeCloseTo(0, 6)
  })

  it('points east at azimuth 90, so azimuth runs clockwise from north', () => {
    const [east, north] = rayOffsetEnu(
      { azimuthDeg: 90, elevationDeg: 0 },
      1000,
    )
    expect(east).toBeCloseTo(1000, 6)
    expect(north).toBeCloseTo(0, 6)
  })

  it('points straight up at elevation 90', () => {
    const [east, north, up] = rayOffsetEnu(
      { azimuthDeg: 137, elevationDeg: 90 },
      500,
    )
    expect(east).toBeCloseTo(0, 6)
    expect(north).toBeCloseTo(0, 6)
    expect(up).toBeCloseTo(500, 6)
  })

  it('dips below the horizontal for a negative elevation', () => {
    const [, , up] = rayOffsetEnu({ azimuthDeg: 0, elevationDeg: -5 }, 1000)
    expect(up).toBeLessThan(0)
  })

  it('keeps the requested length', () => {
    const [east, north, up] = rayOffsetEnu(
      { azimuthDeg: 212.4, elevationDeg: 0.7 },
      40_000,
    )
    expect(Math.hypot(east, north, up)).toBeCloseTo(40_000, CLOSE)
  })
})

describe('parseSkyDirection', () => {
  it('accepts an analysis sample', () => {
    expect(
      parseSkyDirection({
        azimuthDeg: 212.4,
        elevationDeg: 0.7,
        horizonDeg: 0.2,
        visible: true,
      }),
    ).toEqual({
      azimuthDeg: 212.4,
      elevationDeg: 0.7,
      horizonDeg: 0.2,
      visible: true,
    })
  })

  it('rejects an impossible elevation', () => {
    expect(() =>
      parseSkyDirection({
        azimuthDeg: 0,
        elevationDeg: 91,
        horizonDeg: 0,
        visible: true,
      }),
    ).toThrow()
  })

  it('rejects a missing verdict', () => {
    expect(() =>
      parseSkyDirection({ azimuthDeg: 0, elevationDeg: 1, horizonDeg: 0 }),
    ).toThrow()
  })
})

describe('sightMarginDeg', () => {
  it('is how far the body clears the terrain that would block it', () => {
    expect(
      sightMarginDeg({
        azimuthDeg: 212.4,
        elevationDeg: 4,
        horizonDeg: 1.5,
        visible: true,
      }),
    ).toBeCloseTo(2.5, 6)
  })

  it('goes negative once the terrain is in the way', () => {
    expect(
      sightMarginDeg({
        azimuthDeg: 212.4,
        elevationDeg: 0.4,
        horizonDeg: 1.5,
        visible: false,
      }),
    ).toBeCloseTo(-1.1, 6)
  })
})
