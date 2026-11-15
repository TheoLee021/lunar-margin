import { describe, expect, it } from 'vitest'
import type { Candidate, RunDetail } from '../api/candidates'
import {
  comparisonMetrics,
  formatComparisonDistance,
  lunarSurfaceDistanceM,
  nextComparisonIds,
} from './siteCompare'

const config = {
  window: {
    start: '2027-01-10T00:00:00Z',
    end: '2027-01-24T00:00:00Z',
    step_minutes: 30,
  },
  thresholds: { max_terrain_slope_degrees: 10, max_terrain_roughness_m: null },
} as RunDetail['config']

function candidate(
  sun: number | null,
  earth: number | null,
  slope: number | null,
  roughness: number | null,
): Candidate {
  return {
    sun: { fraction: sun, longest_dark_hours: 12 },
    earth: { fraction: earth, longest_blackout_hours: 24 },
    terrain:
      slope === null && roughness === null
        ? null
        : {
            slope_p95_deg: slope,
            roughness_p95_m: roughness,
            coverage_fraction: 1,
          },
  } as Candidate
}

describe('lunar surface great-circle distance', () => {
  it('is zero for identical points and symmetric near the pole', () => {
    const a = { latitude: -89.83, longitude: -153.7 }
    const b = { latitude: -89.7, longitude: 170 }
    expect(lunarSurfaceDistanceM(a, a)).toBe(0)
    expect(lunarSurfaceDistanceM(a, b)).toBeCloseTo(
      lunarSurfaceDistanceM(b, a),
      7,
    )
    expect(lunarSurfaceDistanceM(a, b)).toBeGreaterThan(0)
  })

  it('uses shortest arc across the anti-meridian', () => {
    const a = { latitude: 0, longitude: 179 }
    const b = { latitude: 0, longitude: -179 }
    expect(lunarSurfaceDistanceM(a, b)).toBeCloseTo(
      ((2 * Math.PI) / 180) * 1_737_400,
      5,
    )
  })

  it('rejects invalid geographic coordinates', () => {
    expect(() =>
      lunarSurfaceDistanceM(
        { latitude: 92, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toThrow()
    expect(() =>
      lunarSurfaceDistanceM(
        { latitude: -89, longitude: Number.NaN },
        { latitude: 0, longitude: 0 },
      ),
    ).toThrow()
  })

  it('reports metres and kilometres without implying traverse distance', () => {
    expect(formatComparisonDistance(345)).toBe('345.0 m')
    expect(formatComparisonDistance(1234)).toBe('1.234 km')
  })
})

describe('site comparison', () => {
  it('keeps unknown metrics missing instead of assigning zero scores', () => {
    const metrics = comparisonMetrics(
      candidate(0.8, 0.9, 9.0, null),
      candidate(0.7, 0.8, 4.0, 2.0),
      config,
    )
    expect(metrics).toHaveLength(6)
    expect(metrics.find((m) => m.key === 'roughness')?.aScore).toBeNull()
    expect(metrics.find((m) => m.key === 'earth')?.a).toBe(90)
    expect(metrics.find((m) => m.key === 'slope')?.bScore).toBeCloseTo(60)
  })

  it('never presents terrain scores from incomplete DEM coverage', () => {
    const a = candidate(0.8, 0.9, 2, 3)
    if (a.terrain) a.terrain.coverage_fraction = 0.75
    const metrics = comparisonMetrics(a, candidate(0.8, 0.9, 3, 4), config)
    expect(metrics.find((m) => m.key === 'slope')?.a).toBeNull()
    expect(metrics.find((m) => m.key === 'roughness')?.aScore).toBeNull()
  })

  it('calculates chart scales relative to the same mission window', () => {
    const a = candidate(1, 0, 0, 0)
    const b = candidate(0, 1, 10, 20)
    const metrics = comparisonMetrics(a, b, config)
    expect(metrics.find((m) => m.key === 'sun')?.aScore).toBe(100)
    expect(metrics.find((m) => m.key === 'sun')?.bScore).toBe(0)
    expect(metrics.find((m) => m.key === 'slope')?.bScore).toBe(0)
    expect(metrics.find((m) => m.key === 'roughness')?.bScore).toBe(0)
    expect(metrics.find((m) => m.key === 'dark')?.reference).toContain('336h')
  })

  it('supports selected A, toggling, and replacing B', () => {
    expect(nextComparisonIds([], 'b', 'a')).toEqual(['a', 'b'])
    expect(nextComparisonIds([], 'a', 'a')).toEqual(['a'])
    expect(nextComparisonIds(['a'], 'b', null)).toEqual(['a', 'b'])
    expect(nextComparisonIds(['a', 'b'], 'c', null)).toEqual(['b', 'c'])
    expect(nextComparisonIds(['a', 'b'], 'b', null)).toEqual(['a'])
  })
})
