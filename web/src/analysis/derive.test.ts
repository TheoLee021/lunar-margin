import { describe, expect, it } from 'vitest'
import {
  decimateIndices,
  durationHours,
  evaluateThresholds,
  formatDuration,
  horizonAtAzimuth,
  longestPeriod,
  nearestIndex,
  parseForm,
  polarToXY,
  sortPeriodRows,
  toPeriodRows,
  type FormValues,
} from './derive'

const metrics = {
  visible_fraction: 0.4,
  longest_dark_hours: 96,
  windows_per_24h: 0.9,
  mean_elevation_deg: 0.8,
}

describe('durationHours / longestPeriod', () => {
  const periods = [
    { start: '2027-01-01T00:00:00Z', end: '2027-01-01T06:00:00Z' },
    { start: '2027-01-02T00:00:00Z', end: '2027-01-03T12:00:00Z' },
  ]

  it('computes duration in hours', () => {
    expect(durationHours(periods[0]!)).toBe(6)
    expect(durationHours(periods[1]!)).toBe(36)
  })

  it('finds the longest period, null when empty', () => {
    expect(longestPeriod(periods)).toBe(periods[1])
    expect(longestPeriod([])).toBeNull()
  })
})

describe('formatDuration', () => {
  it('uses hours under a day and days+hours above', () => {
    expect(formatDuration(0)).toBe('0시간')
    expect(formatDuration(5.5)).toBe('5.5시간')
    expect(formatDuration(96)).toBe('4일')
    expect(formatDuration(96.5)).toBe('4일 0.5시간')
  })
})

describe('sortPeriodRows', () => {
  const rows = toPeriodRows(
    [
      { start: '2027-01-02T00:00:00Z', end: '2027-01-02T01:00:00Z' },
      { start: '2027-01-01T00:00:00Z', end: '2027-01-01T10:00:00Z' },
    ],
    'window',
  )

  it('sorts by start ascending and by duration descending', () => {
    expect(sortPeriodRows(rows, 'start', 'asc').map((r) => r.hours)).toEqual([
      10, 1,
    ])
    expect(sortPeriodRows(rows, 'hours', 'desc').map((r) => r.hours)).toEqual([
      10, 1,
    ])
  })

  it('does not mutate the input', () => {
    const before = rows.map((r) => r.start)
    sortPeriodRows(rows, 'start', 'desc')
    expect(rows.map((r) => r.start)).toEqual(before)
  })
})

describe('evaluateThresholds', () => {
  it('returns no checks when no thresholds are given', () => {
    expect(evaluateThresholds(metrics, {})).toEqual([])
  })

  it('fails when visible fraction is below the minimum, with a reason', () => {
    const [check] = evaluateThresholds(metrics, { minVisibleFraction: 0.5 })
    expect(check?.pass).toBe(false)
    expect(check?.reason).toContain('40.0%')
    expect(check?.reason).toContain('50.0%')
  })

  it('passes at exactly the boundary', () => {
    const checks = evaluateThresholds(metrics, {
      minVisibleFraction: 0.4,
      maxDarkHours: 96,
    })
    expect(checks.map((c) => c.pass)).toEqual([true, true])
  })

  it('fails when the longest dark period exceeds the maximum', () => {
    const [check] = evaluateThresholds(metrics, { maxDarkHours: 48 })
    expect(check?.pass).toBe(false)
    expect(check?.reason).toContain('4일')
  })
})

describe('horizonAtAzimuth', () => {
  const horizon = {
    azimuth_deg: [0, 90, 180, 270],
    elevation_deg: [0, 2, 4, 2],
  }

  it('interpolates linearly', () => {
    expect(horizonAtAzimuth(horizon, 45)).toBeCloseTo(1)
  })

  it('wraps between the last sample and 360°', () => {
    // 270°→2, 360°(=0°)→0 : 315° is halfway
    expect(horizonAtAzimuth(horizon, 315)).toBeCloseTo(1)
    expect(horizonAtAzimuth(horizon, -45)).toBeCloseTo(1)
    expect(horizonAtAzimuth(horizon, 405)).toBeCloseTo(1)
  })

  it('returns 0 for an empty profile', () => {
    expect(horizonAtAzimuth({ azimuth_deg: [], elevation_deg: [] }, 10)).toBe(0)
  })
})

describe('polarToXY', () => {
  it('puts north up and east to the right', () => {
    const north = polarToXY(0, 10)
    expect(north.x).toBeCloseTo(0)
    expect(north.y).toBeCloseTo(-10)
    const east = polarToXY(90, 10)
    expect(east.x).toBeCloseTo(10)
    expect(east.y).toBeCloseTo(0)
  })
})

describe('decimateIndices / nearestIndex', () => {
  it('returns all indices when under the limit', () => {
    expect(decimateIndices(4, 10)).toEqual([0, 1, 2, 3])
  })

  it('caps the count and keeps first and last', () => {
    const idx = decimateIndices(1000, 100)
    expect(idx.length).toBeLessThanOrEqual(100)
    expect(idx[0]).toBe(0)
    expect(idx.at(-1)).toBe(999)
  })

  it('finds the nearest index', () => {
    const t = [0, 10, 20, 30]
    expect(nearestIndex(t, 14)).toBe(1)
    expect(nearestIndex(t, 16)).toBe(2)
    expect(nearestIndex(t, -5)).toBe(0)
    expect(nearestIndex(t, 99)).toBe(3)
  })
})

describe('parseForm', () => {
  const valid: FormValues = {
    lat: '-89.7',
    lon: '130',
    start: '2027-01-01T00:00',
    end: '2027-02-01T00:00',
    stepMinutes: '30',
    observerHeightM: '0',
  }

  it('returns API params with UTC Z timestamps', () => {
    const result = parseForm(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params).toEqual({
        lat: -89.7,
        lon: 130,
        start: '2027-01-01T00:00:00Z',
        end: '2027-02-01T00:00:00Z',
        step_minutes: 30,
        observer_height_m: 0,
      })
    }
  })

  it.each([
    ['lat', { lat: '-70' }],
    ['lat', { lat: '-91' }],
    ['lat', { lat: 'abc' }],
    ['lon', { lon: '' }],
    ['stepMinutes', { stepMinutes: '4' }],
    ['stepMinutes', { stepMinutes: '361' }],
    ['observerHeightM', { observerHeightM: '101' }],
    ['observerHeightM', { observerHeightM: '-1' }],
    ['end', { end: '2027-01-01T00:00' }],
    ['end', { end: '2026-12-31T00:00' }],
    ['end', { end: '2030-02-01T00:00' }],
  ] as const)('rejects invalid %s', (field, patch) => {
    const result = parseForm({ ...valid, ...patch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[field]).toBeTruthy()
  })
})
