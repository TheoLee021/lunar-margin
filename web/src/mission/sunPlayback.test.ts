import { describe, expect, it } from 'vitest'
import type { SunPath } from '../api/sunlight'
import { advance, sunAt } from './sunPlayback'

// The Sun a quarter turn further every 6 hours.
const path: SunPath = {
  start: '2027-01-10T00:00:00Z',
  stepMinutes: 360,
  directions: [
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
  ],
}

describe('sunAt', () => {
  it('is the direction of the sample at a sample time', () => {
    expect(sunAt(path, 0)).toEqual([1, 0, 0])
    expect(sunAt(path, 0.25)).toEqual([0, 1, 0])
    expect(sunAt(path, 0.5)).toEqual([-1, 0, 0])
  })

  it('is a unit vector part of the way between two samples', () => {
    const [x, y, z] = sunAt(path, 0.125)
    expect(x).toBeCloseTo(Math.SQRT1_2, 12)
    expect(y).toBeCloseTo(Math.SQRT1_2, 12)
    expect(z).toBe(0)

    // A third of the way from +X to +Y: closer to +X.
    const third = sunAt(path, 0.25 / 3)
    expect(Math.hypot(...third)).toBeCloseTo(1, 12)
    expect(third[0]).toBeGreaterThan(third[1])
  })

  it('stays on the first and last sample outside the path', () => {
    expect(sunAt(path, -1)).toEqual([1, 0, 0])
    expect(sunAt(path, 9)).toEqual([-1, 0, 0])
  })
})

describe('advance', () => {
  it('moves by the playback speed for the time that passed', () => {
    expect(advance(2, 500, 1, 7)).toBe(2.5)
    expect(advance(2, 1000, 3, 7)).toBe(5)
    expect(advance(0, 2000, 0.25, 7)).toBe(0.5)
  })

  it('stops at the end', () => {
    expect(advance(6.9, 1000, 1, 7)).toBe(7)
    expect(advance(7, 16, 1, 7)).toBe(7)
  })
})
