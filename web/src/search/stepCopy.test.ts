import { describe, expect, it } from 'vitest'
import type { RunDetail } from '../api/candidates'
import { stepContent, thresholdLines, thresholdsFor } from './stepCopy'

type Config = RunDetail['config']
type Summary = RunDetail['summary']

const config: Config = {
  roi: { min_lat_deg: -90, max_lat_deg: -85 },
  grid_spacing_m: 500,
  coarse_spacing_m: 2000,
  refine_fraction: 0.25,
  min_separation_m: 2000,
  top_k: 100,
  thresholds: {
    min_sun_fraction: null,
    max_sun_dark_hours: null,
    min_earth_fraction: null,
    max_earth_blackout_hours: null,
  },
  weights: { sun: 0.5, earth: 0.5 },
  window: {
    start: '2027-01-01T00:00:00+00:00',
    end: '2046-01-01T00:00:00+00:00',
    step_minutes: 60,
  },
  dem: '80s_80m',
  observer_height_m: 0,
}

const summary: Summary = {
  counts: {
    coarse_sampled: 18073,
    promoted_coarse: 2100,
    refined: 61000,
    coarse_only: 15973,
    sampled_total: 76973,
    eligible: 76000,
    excluded: 900,
    unevaluated: 73,
    horizon_incomplete: 40000,
    regions: 12,
    selected: 100,
  },
  reasons: {},
  distributions: {},
  warnings: [],
}

function numbers(step: Parameters<typeof stepContent>[0], s = summary) {
  return Object.fromEntries(
    stepContent(step, config, s).numbers.map((n) => [n.label, n.value]),
  )
}

describe('stepContent', () => {
  it('shows the sampled and promoted counts with thousands separators', () => {
    expect(numbers('coarse')['거친 격자 점']).toBe('18,073개')
    expect(numbers('refine')['세밀화로 고른 거친 점']).toBe('2,100개')
    expect(numbers('fine')['세밀하게 계산한 점']).toBe('61,000개')
    expect(numbers('select')['선정된 후보']).toBe('100개')
  })

  it('writes a missing count as a dash, never as 0', () => {
    const missing: Summary = { ...summary, counts: {} }

    expect(numbers('coarse', missing)['거친 격자 점']).toBe('—')
    expect(numbers('filter', missing)['적격']).toBe('—')
  })

  it('mentions the spacing and the share of promoted points in plain words', () => {
    const refine = stepContent('refine', config, summary)

    expect(refine.what).toContain('25%')
    expect(refine.what).toContain('500 m')
  })

  it('explains that no threshold is set yet', () => {
    expect(stepContent('filter', config, summary).what).toContain(
      '임계값이 아직 정해지지 않아',
    )
  })

  it('notes a single-stage run in the coarse step', () => {
    const single: Config = { ...config, coarse_spacing_m: null }

    expect(stepContent('coarse', single, summary).what).toContain(
      '거친 단계 없이',
    )
  })

  it('contains no Japanese characters in any step text', () => {
    for (const step of [
      'coarse',
      'refine',
      'fine',
      'filter',
      'regions',
      'select',
    ] as const) {
      const c = stepContent(step, config, summary)
      const text = [c.title, c.what, c.why, ...c.numbers.map((n) => n.label)]
      for (const t of text) expect(/[぀-ヿ]/.test(t)).toBe(false)
    }
  })
})

describe('thresholds', () => {
  it('lists only the decided thresholds', () => {
    const lines = thresholdLines({
      min_sun_fraction: 0.3,
      max_sun_dark_hours: null,
      min_earth_fraction: null,
      max_earth_blackout_hours: 48,
    })

    expect(lines).toEqual(['일조율 30.0% 이상', '최장 통신 두절 2일 이하'])
  })

  it('converts search thresholds into analysis-view thresholds per kind', () => {
    const t = {
      min_sun_fraction: 0.3,
      max_sun_dark_hours: 100,
      min_earth_fraction: null,
      max_earth_blackout_hours: 48,
    }

    expect(thresholdsFor('illumination', t)).toEqual({
      minVisibleFraction: 0.3,
      maxDarkHours: 100,
    })
    expect(thresholdsFor('earth-visibility', t)).toEqual({
      maxDarkHours: 48,
    })
  })
})
