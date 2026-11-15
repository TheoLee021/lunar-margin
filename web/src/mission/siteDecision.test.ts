import { describe, expect, it } from 'vitest'
import type { SiteAssessment } from '../api/analysis'
import { judgeSite, type MissionConstraints } from './siteDecision'

const LIMITS: MissionConstraints = {
  minEarthPercent: 60,
  maxDarkHours: 48,
  maxSlopeDeg: 10,
}

function site(
  terrain: Partial<SiteAssessment['terrain']> = {},
): SiteAssessment {
  return {
    lat: -89.5,
    lon: 222,
    start: '2027-01-10T00:00:00Z',
    end: '2027-01-24T00:00:00Z',
    step_minutes: 30,
    observer_height_m: 0,
    sun: {
      visible_fraction: 0.8,
      longest_dark_hours: 36,
      windows_per_24h: 1,
      mean_elevation_deg: 1.2,
    },
    earth: {
      visible_fraction: 0.7,
      longest_dark_hours: 48,
      windows_per_24h: 0.5,
      mean_elevation_deg: 4,
    },
    solar_continuity: { longest_sun_visible_hours: 48, visibility_transitions: 5 },
    terrain: {
      slope_p95_deg: 3.5,
      coverage_fraction: 1,
      assessment_radius_m: 250,
      slope_baseline_m: 160,
      roughness_window_m: 400,
      dem_pixel_m: 80,
      landing_safety_status: 'UNVERIFIED',
      ...terrain,
    },
  }
}

const failed = (verdict: ReturnType<typeof judgeSite>) =>
  verdict.checks.filter((check) => !check.pass).map((check) => check.id)

describe('judgeSite', () => {
  it('passes when every mission constraint is met', () => {
    const verdict = judgeSite(site(), LIMITS, 50)

    expect(verdict.pass).toBe(true)
    expect(failed(verdict)).toEqual([])
  })

  it('weights Earth and Sun visibility by the communication weight', () => {
    expect(judgeSite(site(), LIMITS, 50).score).toBeCloseTo(75)
    expect(judgeSite(site(), LIMITS, 100).score).toBeCloseTo(70)
    expect(judgeSite(site(), LIMITS, 0).score).toBeCloseTo(80)
  })

  it('fails a steep site and says why, even with good visibility', () => {
    const verdict = judgeSite(site({ slope_p95_deg: 24.6 }), LIMITS, 50)

    expect(verdict.pass).toBe(false)
    expect(failed(verdict)).toEqual(['slope'])
    const slope = verdict.checks.find((check) => check.id === 'slope')
    expect(slope?.reason).toContain('24.6°')
    expect(slope?.reason).toContain('10°')
  })

  it('fails incomplete DEM coverage even when the measured slope is gentle', () => {
    const verdict = judgeSite(
      site({ slope_p95_deg: 3, coverage_fraction: 0.873 }),
      LIMITS,
      50,
    )

    expect(verdict.pass).toBe(false)
    expect(failed(verdict)).toEqual(['terrain_coverage'])
    const coverage = verdict.checks.find(
      (check) => check.id === 'terrain_coverage',
    )
    expect(coverage?.reason).toContain('87.3%')
  })

  it('fails both terrain checks when the DEM has no valid samples', () => {
    const verdict = judgeSite(
      site({ slope_p95_deg: null, coverage_fraction: 0 }),
      LIMITS,
      50,
    )

    expect(verdict.pass).toBe(false)
    expect(failed(verdict)).toEqual(['slope', 'terrain_coverage'])
  })
})
