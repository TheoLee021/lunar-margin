import { describe, expect, it } from 'vitest'
import type { RunDetail } from '../api/candidates'
import { detailPeriod, detailPeriodText, funnelSteps } from './derive'
import { stepContent, windowSpanText } from './stepCopy'

type Config = RunDetail['config']
type Summary = RunDetail['summary']

function config(start: string, end: string): Config {
  return {
    roi: { min_lat_deg: -90, max_lat_deg: -85 },
    grid_spacing_m: 500,
    coarse_spacing_m: 2000,
    refine_fraction: 0.25,
    min_separation_m: 2000,
    top_k: 100,
    thresholds: {
      min_sun_fraction: null,
      max_sun_dark_hours: 24,
      min_earth_fraction: null,
      max_earth_blackout_hours: 6,
    },
    weights: { sun: 0.5, earth: 0.5 },
    window: { start, end, step_minutes: 30 },
    dem: '80s_80m',
    observer_height_m: 0,
  }
}

const summary: Summary = {
  counts: { coarse_sampled: 18_073 },
  reasons: {},
  distributions: {},
  warnings: [],
}

describe('windowSpanText', () => {
  it('says days for a mission-length window (never rounds 14 days up to 1 year)', () => {
    expect(
      windowSpanText({
        start: '2027-01-01T00:00:00+00:00',
        end: '2027-01-15T00:00:00+00:00',
        step_minutes: 30,
      }),
    ).toBe('14일')
  })

  it('says years for a long window', () => {
    expect(
      windowSpanText({
        start: '2027-01-01T00:00:00+00:00',
        end: '2046-01-01T00:00:00+00:00',
        step_minutes: 60,
      }),
    ).toBe('19년')
  })

  it('keeps one full year as 365일 or 1년 without inventing a month count', () => {
    const text = windowSpanText({
      start: '2027-01-01T00:00:00+00:00',
      end: '2028-01-01T00:00:00+00:00',
      step_minutes: 60,
    })

    expect(['365일', '1년']).toContain(text)
  })
})

describe('step 1 copy uses the real window span', () => {
  it('mentions 14일, not 1년, for a 14-day mission', () => {
    const content = stepContent(
      'coarse',
      config('2027-01-01T00:00:00+00:00', '2027-01-15T00:00:00+00:00'),
      summary,
    )

    expect(content.what).toContain('14일 동안')
    expect(content.what).not.toContain('1년')
    expect(content.numbers.find((n) => n.label === '계산한 기간')?.value).toBe(
      '14일',
    )
  })
})

describe('step 4 copy uses the mission thresholds', () => {
  it('states the real limits', () => {
    const content = stepContent(
      'filter',
      config('2027-01-01T00:00:00+00:00', '2027-01-15T00:00:00+00:00'),
      summary,
    )

    expect(content.what).toContain('최장 암흑 24시간 이하')
    expect(content.what).toContain('최장 통신 두절 6시간 이하')
  })
})

describe('detailPeriod (the period used when opening a site in detail)', () => {
  it('is the whole run window when it is no longer than a year', () => {
    expect(
      detailPeriod({
        start: '2027-01-01T00:00:00+00:00',
        end: '2027-01-15T00:00:00+00:00',
        step_minutes: 30,
      }),
    ).toEqual({ start: '2027-01-01T00:00:00Z', end: '2027-01-15T00:00:00Z' })
  })

  it('is the first year of a longer window (the analysis API takes up to 3 years)', () => {
    expect(
      detailPeriod({
        start: '2027-01-01T00:00:00+00:00',
        end: '2046-01-01T00:00:00+00:00',
        step_minutes: 60,
      }),
    ).toEqual({ start: '2027-01-01T00:00:00Z', end: '2028-01-01T00:00:00Z' })
  })

  it('describes itself in one sentence', () => {
    expect(
      detailPeriodText({
        start: '2027-01-01T00:00:00+00:00',
        end: '2027-01-15T00:00:00+00:00',
        step_minutes: 30,
      }),
    ).toBe('2027-01-01부터 임무 기간 전체(14일)를')
    expect(
      detailPeriodText({
        start: '2027-01-01T00:00:00+00:00',
        end: '2046-01-01T00:00:00+00:00',
        step_minutes: 60,
      }),
    ).toBe('2027-01-01부터 1년을')
  })
})

describe('funnelSteps in_regions', () => {
  const counts = {
    sampled_total: 1000,
    computed: 1000,
    eligible: 600,
    in_regions: 450,
    selected: 20,
  }

  it('prefers the server-provided in_regions count', () => {
    const step = funnelSteps(counts, { not_refined: 100 }).find(
      (s) => s.id === 'in_regions',
    )

    expect(step?.value).toBe(450)
  })

  it('still falls back to eligible - not_refined for older runs', () => {
    const { in_regions: _unused, ...older } = counts
    const step = funnelSteps(older, { not_refined: 100 }).find(
      (s) => s.id === 'in_regions',
    )

    expect(step?.value).toBe(500)
  })
})
