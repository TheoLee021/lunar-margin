import { describe, expect, it } from 'vitest'
import {
  comparisonAxes,
  comparisonValues,
  toggleComparison,
} from './siteCompare'

const config = {
  window: { start: '2027-01-10T00:00:00Z', end: '2027-01-24T00:00:00Z' },
  thresholds: { max_terrain_slope_degrees: 10, max_terrain_roughness_m: 4 },
}

describe('saved candidate comparison', () => {
  it('uses the same physical scale for every selection and reverses lower-is-better axes', () => {
    const axes = comparisonAxes(config)
    const values = comparisonValues(
      {
        sun: { fraction: 0.8, longest_dark_hours: 84 },
        rf: { min_link_margin_db: -6 },
        earth: { fraction: 0.9, longest_blackout_hours: 168 },
        terrain: {
          coverage_fraction: 1,
          slope_p95_deg: 2.5,
          roughness_p95_m: 3,
        },
      },
      axes,
    )
    expect(values.map((value) => value.radius)).toEqual([
      0.8, 0.75, 0.4, 0.5, 0.75, 0.25,
    ])
    expect(values.map((value) => value.value)).toEqual([
      80, 84, -6, 168, 2.5, 3,
    ])
  })

  it('keeps unavailable and incomplete terrain metrics out of the polygon', () => {
    const values = comparisonValues(
      {
        sun: { fraction: null, longest_dark_hours: 0 },
        earth: { fraction: 1, longest_blackout_hours: null },
        terrain: {
          coverage_fraction: 0.9,
          slope_p95_deg: 0,
          roughness_p95_m: 0,
        },
      },
      comparisonAxes(config),
    )
    expect(values.map((value) => value.radius)).toEqual([
      null,
      1,
      null,
      null,
      null,
      null,
    ])
  })

  it('keeps original values beyond the display range and uses explicit fallbacks for zero limits', () => {
    const axes = comparisonAxes({
      ...config,
      thresholds: { max_terrain_slope_degrees: 0 },
    })
    const values = comparisonValues(
      {
        sun: { fraction: 0.5, longest_dark_hours: 400 },
        earth: { fraction: 0.5, longest_blackout_hours: 0 },
        terrain: {
          coverage_fraction: 1,
          slope_p95_deg: 30,
          roughness_p95_m: 40,
        },
      },
      axes,
    )
    expect(values[1]).toEqual({ value: 400, radius: 0 })
    expect(values[4]).toEqual({ value: 30, radius: 0 })
    expect(axes[4]?.referenceLabel).toContain('안전 한도 아님')
  })

  it('checks at most the top five without replacing another candidate or adding the map selection', () => {
    const allowed = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(toggleComparison([], 'b', allowed)).toEqual(['b'])
    expect(toggleComparison(['a', 'b'], 'c', allowed)).toEqual(['a', 'b', 'c'])
    expect(toggleComparison(['a', 'b', 'c', 'd', 'e'], 'f', allowed)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
    expect(toggleComparison(['a', 'b'], 'a', allowed)).toEqual(['b'])
    expect(toggleComparison(['stale', 'a', 'a'], 'b', allowed)).toEqual([
      'a',
      'b',
    ])
  })

  it('rejects an invalid comparison interval', () => {
    expect(() =>
      comparisonAxes({ ...config, window: { start: 'bad', end: 'bad' } }),
    ).toThrow()
  })
})
