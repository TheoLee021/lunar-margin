import { describe, expect, it } from 'vitest'
import type { SearchThresholds } from '../api/candidates'
import { dominantExclusion, filterExclusions } from './exclusions'

const THRESHOLDS: SearchThresholds = {
  min_sun_fraction: null,
  max_sun_dark_hours: 24,
  min_earth_fraction: null,
  max_earth_blackout_hours: 6,
}

describe('filterExclusions', () => {
  it('keeps only condition reasons with sites, largest first, with Korean labels', () => {
    const rows = filterExclusions({
      sun_dark_hours_above_max: 10,
      earth_blackout_hours_above_max: 300,
      sun_fraction_below_min: 0,
      not_refined: 9_999, // 조건이 아니라 계산 방식 때문이라 제외 사유에서 뺀다
      beyond_top_k: 5_000,
    })

    expect(rows.map((row) => row.key)).toEqual([
      'earth_blackout_hours_above_max',
      'sun_dark_hours_above_max',
    ])
    expect(rows[0]?.count).toBe(300)
    expect(rows[0]?.label).toContain('통신 두절')
  })

  it('is empty when no condition excluded anything', () => {
    expect(filterExclusions({ not_refined: 12 })).toEqual([])
  })
})

describe('dominantExclusion', () => {
  it('names the condition that excluded the most sites and the limit the user set', () => {
    const result = dominantExclusion(
      { sun_dark_hours_above_max: 120, earth_blackout_hours_above_max: 40_000 },
      THRESHOLDS,
    )

    expect(result?.key).toBe('earth_blackout_hours_above_max')
    expect(result?.count).toBe(40_000)
    expect(result?.limit).toBe('최장 통신 두절 6시간 이하')
    expect(result?.advice).toContain('6시간')
    expect(result?.advice).toContain('늘려')
  })

  it('works for the darkness limit', () => {
    const result = dominantExclusion(
      { sun_dark_hours_above_max: 500, earth_blackout_hours_above_max: 40 },
      THRESHOLDS,
    )

    expect(result?.key).toBe('sun_dark_hours_above_max')
    expect(result?.limit).toBe('최장 연속 암흑 24시간 이하')
  })

  it('suggests lowering a minimum when a minimum excluded the most', () => {
    const result = dominantExclusion(
      { sun_fraction_below_min: 900 },
      { ...THRESHOLDS, min_sun_fraction: 0.4 },
    )

    expect(result?.advice).toContain('낮춰')
    expect(result?.limit).toContain('40.0%')
  })

  it('is null when nothing was excluded by a condition', () => {
    expect(dominantExclusion({ not_refined: 5 }, THRESHOLDS)).toBeNull()
    expect(dominantExclusion({}, THRESHOLDS)).toBeNull()
  })

  it('still answers when the limit is unknown (reason without a matching threshold)', () => {
    const result = dominantExclusion({ horizon_incomplete: 77 }, THRESHOLDS)

    expect(result?.key).toBe('horizon_incomplete')
    expect(result?.limit).toBeNull()
  })
})
