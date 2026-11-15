import { describe, expect, it } from 'vitest'
import type { Candidate } from '../api/candidates'
import {
  STEPS,
  allThresholdsNull,
  count,
  funnelSteps,
  imageToXy,
  isInsideRoi,
  layerStatesFor,
  lonLatToXy,
  nextStepIndex,
  oneYearFrom,
  reasonLabel,
  shortHash,
  sortCandidates,
  stepLayers,
  xyToImage,
  xyToLonLat,
  type MapGeometry,
} from './derive'

const MAP: MapGeometry = {
  size_px: 11,
  center_px: 5,
  pixel_size_m: 500,
  rho_max_m: 2000,
}

function candidate(rank: number, overrides: Partial<Candidate> = {}) {
  const base: Candidate = {
    id: `C${rank}`,
    rank,
    lat_deg: -89,
    lon_deg: 10 * rank,
    x_m: 0,
    y_m: 0,
    grid_spacing_m: 500,
    sun: {
      fraction: 0.5,
      longest_dark_hours: 100,
      windows_per_24h: 0.1,
      mean_elevation_deg: 1,
    },
    earth: {
      fraction: 0.4,
      longest_blackout_hours: 90,
      windows_per_24h: 0.1,
      mean_elevation_deg: 2,
    },
    eligibility: { status: 'eligible', failed: [], not_applied: [] },
    score: {
      total: 0.5,
      sun_component: 0.5,
      earth_component: 0.4,
      components_used: 2,
    },
    region_id: rank,
    data_quality: {
      horizon_complete: true,
      horizon_max_deg: 1,
      missing_metrics: [],
      stage: 'fine',
    },
    selection: { picked_as: 'fill', note: '' },
  }
  return { ...base, ...overrides }
}

describe('projection', () => {
  it('puts the pole at the origin and longitude 0 on +y', () => {
    expect(xyToLonLat(0, 0).lat).toBeCloseTo(-90, 9)
    const p = xyToLonLat(0, 1000)
    expect(p.lon).toBeCloseTo(0, 9)
    expect(p.lat).toBeCloseTo(-90 + (1000 / 1_737_400) * (180 / Math.PI), 4)
    expect(xyToLonLat(1000, 0).lon).toBeCloseTo(90, 6)
    expect(xyToLonLat(0, -1000).lon).toBeCloseTo(180, 6)
    expect(xyToLonLat(-1000, 0).lon).toBeCloseTo(270, 6)
  })

  it('round-trips lat/lon through x/y', () => {
    for (const [lat, lon] of [
      [-89.7, 130],
      [-85, 0.5],
      [-88.1, 359.9],
    ] as const) {
      const { x, y } = lonLatToXy(lat, lon)
      const back = xyToLonLat(x, y)
      expect(back.lat).toBeCloseTo(lat, 9)
      expect(back.lon).toBeCloseTo(lon, 7)
    }
  })

  it('maps image pixels to projected metres following the contract', () => {
    // 픽셀 (col,row) 의 x = (col - center) * pixel, y = (center - row) * pixel
    // 이미지 좌표(연속)에서는 픽셀 중심이 col + 0.5 이다.
    expect(imageToXy(5.5, 5.5, MAP)).toEqual({ x_m: 0, y_m: 0 })
    expect(imageToXy(7.5, 3.5, MAP)).toEqual({ x_m: 1000, y_m: 1000 })
  })

  it('inverts imageToXy', () => {
    const { x_m, y_m } = imageToXy(2.25, 8.75, MAP)
    const { u, v } = xyToImage(x_m, y_m, MAP)

    expect(u).toBeCloseTo(2.25, 9)
    expect(v).toBeCloseTo(8.75, 9)
  })

  it('treats the ROI ring as inclusive', () => {
    expect(isInsideRoi(2000, 0, MAP)).toBe(true)
    expect(isInsideRoi(2000.01, 0, MAP)).toBe(false)
    expect(isInsideRoi(1500, 1500, MAP)).toBe(false)
  })
})

describe('counts and funnel', () => {
  const counts = {
    sampled_total: 1000,
    computed: 990,
    eligible: 800,
    selected: 12,
  }

  it('reads missing counts as null, never 0', () => {
    expect(count(counts, 'selected')).toBe(12)
    expect(count(counts, 'refined')).toBeNull()
  })

  it('builds the funnel from counts and the not_refined reason', () => {
    const steps = funnelSteps(counts, { not_refined: 600 })

    expect(steps.map((s) => s.id)).toEqual([
      'sampled',
      'computed',
      'eligible',
      'in_regions',
      'selected',
    ])
    expect(steps.map((s) => s.value)).toEqual([1000, 990, 800, 200, 12])
  })

  it('skips the in-regions step when the reason is not reported', () => {
    const steps = funnelSteps(counts, {})

    expect(steps.map((s) => s.id)).toEqual([
      'sampled',
      'computed',
      'eligible',
      'selected',
    ])
  })

  it('skips steps whose count is missing', () => {
    expect(funnelSteps({ sampled_total: 5 }, {}).map((s) => s.id)).toEqual([
      'sampled',
    ])
  })
})

describe('labels', () => {
  it('has Korean text for every reason in the contract', () => {
    for (const key of [
      'sun_fraction_below_min',
      'sun_dark_hours_above_max',
      'earth_fraction_below_min',
      'earth_blackout_hours_above_max',
      'horizon_incomplete',
      'no_metrics',
      'not_refined',
      'within_min_separation',
      'beyond_top_k',
    ]) {
      expect(reasonLabel(key)).not.toBe(key)
      expect(/[가-힣]/.test(reasonLabel(key))).toBe(true)
    }
  })

  it('falls back to the raw key for an unknown reason', () => {
    expect(reasonLabel('something_new')).toBe('something_new')
  })

  it('shortens hashes', () => {
    expect(shortHash('abcdef0123456789')).toBe('abcdef01…')
    expect(shortHash('')).toBe('—')
  })
})

describe('steps', () => {
  it('has the six steps in order', () => {
    expect(STEPS.map((s) => s.id)).toEqual([
      'coarse',
      'refine',
      'fine',
      'filter',
      'regions',
      'select',
    ])
  })

  it('shows only contract layers, with the chosen metric', () => {
    expect(stepLayers('coarse', 'sun').map((l) => l.name)).toEqual([
      'coarse_sun',
    ])
    expect(stepLayers('coarse', 'earth').map((l) => l.name)).toEqual([
      'coarse_earth',
    ])
    expect(stepLayers('refine', 'sun').map((l) => l.name)).toEqual([
      'coarse_sun',
      'coarse_promoted',
    ])
    expect(stepLayers('filter', 'earth').map((l) => l.name)).toEqual([
      'earth',
      'eligibility',
    ])
    expect(stepLayers('regions', 'sun').map((l) => l.name)).toContain('regions')
  })

  it('turns on only the preset layers that the server provides', () => {
    const states = layerStatesFor(stepLayers('refine', 'sun'), [
      'coarse_sun',
      'sun',
    ])

    expect(states.coarse_sun).toEqual({ on: true, opacity: 0.55 })
    expect(states.coarse_promoted.on).toBe(false) // 서버가 주지 않은 레이어
    expect(states.sun.on).toBe(false) // 이 단계의 기본이 아님
    expect(Object.keys(states)).toHaveLength(9)
  })

  it('moves one step at a time and stops at the ends', () => {
    expect(nextStepIndex(0, 1, 6)).toBe(1)
    expect(nextStepIndex(5, 1, 6)).toBeNull()
    expect(nextStepIndex(0, -1, 6)).toBeNull()
    expect(nextStepIndex(3, -1, 6)).toBe(2)
  })
})

describe('sorting', () => {
  const rows = [
    candidate(1, {
      sun: { ...candidate(1).sun, fraction: 0.3 },
      score: { ...candidate(1).score, total: 0.3 },
    }),
    candidate(2, {
      sun: { ...candidate(2).sun, fraction: null },
      score: { ...candidate(2).score, total: null },
    }),
    candidate(3, {
      sun: { ...candidate(3).sun, fraction: 0.9 },
      score: { ...candidate(3).score, total: 0.9 },
    }),
  ]

  it('sorts numbers and keeps missing values last in both directions', () => {
    expect(sortCandidates(rows, 'sun', 'desc').map((r) => r.rank)).toEqual([
      3, 1, 2,
    ])
    expect(sortCandidates(rows, 'sun', 'asc').map((r) => r.rank)).toEqual([
      1, 3, 2,
    ])
    expect(sortCandidates(rows, 'score', 'desc').map((r) => r.rank)).toEqual([
      3, 1, 2,
    ])
  })

  it('sorts by rank and by id without mutating the input', () => {
    const before = rows.map((r) => r.rank)

    expect(sortCandidates(rows, 'rank', 'desc').map((r) => r.rank)).toEqual([
      3, 2, 1,
    ])
    expect(sortCandidates(rows, 'id', 'asc').map((r) => r.id)).toEqual([
      'C1',
      'C2',
      'C3',
    ])
    expect(rows.map((r) => r.rank)).toEqual(before)
  })
})

describe('analysis window for a candidate', () => {
  it('takes one year from the run window start', () => {
    expect(oneYearFrom('2027-01-01T00:00:00+00:00')).toEqual({
      start: '2027-01-01T00:00:00Z',
      end: '2028-01-01T00:00:00Z',
    })
  })

  it('clamps Feb 29 to Feb 28 of the next year', () => {
    expect(oneYearFrom('2028-02-29T00:00:00Z').end).toBe('2029-02-28T00:00:00Z')
  })
})

describe('thresholds', () => {
  it('detects when no threshold has been decided', () => {
    expect(
      allThresholdsNull({
        min_sun_fraction: null,
        max_sun_dark_hours: null,
        min_earth_fraction: null,
        max_earth_blackout_hours: null,
      }),
    ).toBe(true)
    expect(
      allThresholdsNull({
        min_sun_fraction: 0,
        max_sun_dark_hours: null,
        min_earth_fraction: null,
        max_earth_blackout_hours: null,
      }),
    ).toBe(false)
  })
})
