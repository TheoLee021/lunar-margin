import { describe, expect, it } from 'vitest'
import type { Candidate, SearchConfig } from '../api/candidates'
import { marginSummary, requirementMargins } from './requirementMargins'

// Only fields consumed by this pure function are needed in the fixture.
const candidate = {
  id: 'site-1',
  sun: { fraction: 0.6, longest_dark_hours: 20 },
  earth: { fraction: 0.75, longest_blackout_hours: 4 },
  terrain: { slope_p95_deg: 8, roughness_p95_m: 1.5 },
  rf: { fraction: 0.8, longest_blackout_hours: 5 },
} as Candidate
const config = {
  thresholds: {
    min_sun_fraction: 0.5,
    max_sun_dark_hours: 24,
    min_earth_fraction: 0.7,
    max_earth_blackout_hours: 6,
    max_terrain_slope_degrees: 10,
    max_terrain_roughness_m: 2,
  },
  rf: null,
} as SearchConfig

describe('Mission Engineering requirement margins', () => {
  it('computes positive margins for a compliant geometric-LOS case', () => {
    const rows = requirementMargins(candidate, config)
    expect(rows.map((x) => x.key)).toEqual([
      'sun-fraction',
      'sun-dark',
      'communication-fraction',
      'communication-blackout',
      'slope',
      'roughness',
    ])
    expect(rows.find((r) => r.key === 'sun-dark')?.margin).toBe(4)
    expect(rows.find((r) => r.key === 'slope')?.margin).toBe(2)
    expect(rows.every((row) => row.status === 'PASS')).toBe(true)
  })

  it('marks negative constraints as FAIL instead of hiding behind an overall score', () => {
    const rows = requirementMargins(
      { ...candidate, sun: { ...candidate.sun, longest_dark_hours: 30 } },
      config,
    )
    expect(marginSummary(rows)).toBe('FAIL')
    expect(rows.find((r) => r.key === 'sun-dark')?.margin).toBe(-6)
  })

  it('uses RF metrics and thresholds when saved search has RF enabled', () => {
    const rows = requirementMargins(candidate, {
      ...config,
      rf: {} as NonNullable<SearchConfig['rf']>,
      thresholds: {
        ...config.thresholds,
        min_rf_fraction: 0.8,
        max_rf_blackout_hours: 6,
      },
    })
    expect(rows.find((r) => r.key === 'communication-fraction')?.margin).toBe(0)
    expect(rows.find((r) => r.key === 'communication-blackout')?.margin).toBe(1)
  })

  it('does not interpret missing data as zero or PASS', () => {
    const rows = requirementMargins(
      { ...candidate, rf: null, terrain: null },
      {
        ...config,
        rf: {} as NonNullable<SearchConfig['rf']>,
        thresholds: { ...config.thresholds, min_rf_fraction: 0.8 },
      },
    )
    expect(rows.find((r) => r.key === 'communication-fraction')?.status).toBe('UNKNOWN')
    expect(rows.find((r) => r.key === 'slope')?.status).toBe('UNKNOWN')
    expect(marginSummary(rows)).toBe('UNKNOWN')
  })

  it('omits unset constraints rather than inventing lander requirements', () => {
    const rows = requirementMargins(candidate, {
      ...config,
      thresholds: {
        min_sun_fraction: null,
        max_sun_dark_hours: null,
        min_earth_fraction: null,
        max_earth_blackout_hours: null,
        max_terrain_slope_degrees: null,
        max_terrain_roughness_m: null,
      },
    })
    expect(rows).toHaveLength(0)
    expect(marginSummary(rows)).toBe('NOT_ASSESSED')
  })
})
