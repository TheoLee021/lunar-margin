import { describe, expect, it } from 'vitest'
import type { Candidate, SearchConfig } from '../api/candidates'
import { marginSummary, requirementMargins } from './requirementMargins'

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

describe('Requirement margins', () => {
  it('computes saved requirement margins', () => {
    const rows = requirementMargins(candidate, config)
    expect(marginSummary(rows)).toBe('PASS')
    const dark = rows.find((row) => row.key === 'sun-dark')
    expect(dark?.margin).toBe(4)
  })

  it('detects failed darkness requirement', () => {
    const bad = { ...candidate, sun: { ...candidate.sun } }
    bad.sun.longest_dark_hours = 30
    const rows = requirementMargins(bad, config)
    expect(marginSummary(rows)).toBe('FAIL')
  })

  it('keeps missing values unknown', () => {
    const missing = { ...candidate, terrain: null }
    const rows = requirementMargins(missing, config)
    expect(marginSummary(rows)).toBe('UNKNOWN')
  })

  it('uses RF values for an RF-configured run', () => {
    const withRf = { ...config, rf: {} }
    withRf.thresholds.min_rf_fraction = 0.8
    const rows = requirementMargins(candidate, withRf as SearchConfig)
    const comm = rows.find((row) => row.key === 'communication-fraction')
    expect(comm?.margin).toBe(0)
  })
})
