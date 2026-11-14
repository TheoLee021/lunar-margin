import { expect, it } from 'vitest'
import type { SiteAssessment } from '../api/siteAssessment'
import { assessCandidate } from './siteDecision'

const site: SiteAssessment = {
  lat: -89.5,
  lon: 222,
  start: '2027-01-10T00:00:00Z',
  end: '2027-01-17T00:00:00Z',
  step_minutes: 30,
  sun: {
    visible_fraction: 0.8,
    longest_dark_hours: 36,
    windows_per_24h: 1,
  },
  earth: {
    visible_fraction: 0.7,
    longest_dark_hours: 48,
    windows_per_24h: 0.5,
  },
  terrain: {
    elevation_m: 450,
    slope_deg: 3.5,
    roughness_rms_m: 1.5,
    slope_baseline_m: 160,
    roughness_window_m: 400,
    dem_pixel_m: 80,
    limitation: 'Not a footpad hazard model',
  },
}

it('passes when every hard constraint is met', () => {
  const result = assessCandidate(
    site,
    {
      minEarthPercent: 60,
      maxDarkHours: 48,
      maxSlopeDeg: 10,
    },
    50,
  )
  expect(result.pass).toBe(true)
  expect(result.checks).toHaveLength(3)
  expect(result.score).toBeCloseTo(75)
})

it('reports which requirement failed without masking it with high Sun fraction', () => {
  const result = assessCandidate(
    {
      ...site,
      earth: { ...site.earth, visible_fraction: 0.3 },
      terrain: { ...site.terrain, slope_deg: 15 },
    },
    {
      minEarthPercent: 60,
      maxDarkHours: 48,
      maxSlopeDeg: 10,
    },
    50,
  )
  expect(result.pass).toBe(false)
  expect(
    result.checks.filter((check) => !check.pass).map((check) => check.id),
  ).toEqual(['visible_fraction', 'slope'])
})

it('uses inclusive bounds at exact constraints', () => {
  const result = assessCandidate(
    site,
    {
      minEarthPercent: 70,
      maxDarkHours: 36,
      maxSlopeDeg: 3.5,
    },
    100,
  )
  expect(result.pass).toBe(true)
  expect(result.score).toBeCloseTo(70)
})
