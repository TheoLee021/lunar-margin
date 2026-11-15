import { describe, expect, it } from 'vitest'
import { parseSkyDirection, rayOffsetEnu } from './lineOfSight'

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
        visible: true,
      }),
    ).toEqual({ azimuthDeg: 212.4, elevationDeg: 0.7, visible: true })
  })

  it('rejects an impossible elevation', () => {
    expect(() =>
      parseSkyDirection({
        azimuthDeg: 0,
        elevationDeg: 91,
        visible: true,
      }),
    ).toThrow()
  })

  it('rejects a missing verdict', () => {
    expect(() =>
      parseSkyDirection({ azimuthDeg: 0, elevationDeg: 1 }),
    ).toThrow()
  })
})
