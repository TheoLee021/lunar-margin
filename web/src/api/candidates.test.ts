import { describe, expect, it } from 'vitest'
import {
  CandidateSchema,
  RunDetailSchema,
  RunListSchema,
  fetchRun,
  fetchRuns,
  isValidRunId,
  layerUrl,
  runPath,
} from './candidates'

const candidate = {
  id: 'SP500_+12_-30',
  rank: 1,
  lat_deg: -89.31,
  lon_deg: 222.4,
  x_m: 6000,
  y_m: -15000,
  grid_spacing_m: 500,
  sun: {
    fraction: 0.61,
    longest_dark_hours: 210,
    windows_per_24h: 0.04,
    mean_elevation_deg: 0.7,
  },
  earth: {
    fraction: null,
    longest_blackout_hours: null,
    windows_per_24h: null,
    mean_elevation_deg: null,
  },
  eligibility: { status: 'eligible', failed: [], not_applied: [] },
  score: {
    total: 0.61,
    sun_component: 0.61,
    earth_component: null,
    components_used: 1,
  },
  region_id: 3,
  data_quality: {
    horizon_complete: false,
    horizon_max_deg: 2.4,
    missing_metrics: ['earth_fraction'],
    stage: 'fine',
  },
  selection: { picked_as: 'region_best', note: '' },
}

const window = {
  start: '2027-01-01T00:00:00+00:00',
  end: '2046-01-01T00:00:00+00:00',
  step_minutes: 60,
}

const detail = {
  id: 'default',
  source: {
    dem: {
      name: '80s_80m',
      file: 'ldem_80s_80m_float.img',
      sha256: 'a'.repeat(64),
      resolution_m: 80,
    },
    spice_kernels: [{ name: 'de440s.bsp', sha256: 'b'.repeat(64) }],
    window,
    projection: 'polar stereographic',
    plan_id: 'south_polar_dense',
  },
  config: {
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
    window,
    dem: '80s_80m',
    observer_height_m: 0,
    workers: null,
  },
  summary: {
    counts: { sampled_total: 100, selected: 1 },
    distributions: { sun_fraction: { min: 0, max: 0.6 } },
    warnings: ['경고'],
  },
  run: {
    generated_at: '2026-11-14T20:01:12+00:00',
    elapsed_seconds: 812.4,
    workers: 14,
  },
  map: {
    size_px: 607,
    center_px: 303,
    pixel_size_m: 500,
    rho_max_m: 151712.3,
    layers: ['sun'],
  },
  candidates: [candidate],
}

describe('candidate schema', () => {
  it('keeps missing metrics as null instead of 0', () => {
    const parsed = CandidateSchema.parse(candidate)

    expect(parsed.earth.fraction).toBeNull()
    expect(parsed.score.earth_component).toBeNull()
  })

  it('rejects an unknown eligibility status', () => {
    const bad = {
      ...candidate,
      eligibility: { ...candidate.eligibility, status: 'maybe' },
    }

    expect(CandidateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects metrics that are not numbers or null', () => {
    const bad = { ...candidate, sun: { ...candidate.sun, fraction: 'x' } }

    expect(CandidateSchema.safeParse(bad).success).toBe(false)
  })
})

describe('run detail schema', () => {
  it('accepts the contract example and defaults reasons to an empty object', () => {
    const parsed = RunDetailSchema.parse(detail)

    expect(parsed.summary.reasons).toEqual({})
    expect(parsed.config.thresholds.min_sun_fraction).toBeNull()
    expect(parsed.config.coarse_spacing_m).toBe(2000)
  })

  it('accepts a single-stage run (coarse_spacing_m is null)', () => {
    const parsed = RunDetailSchema.parse({
      ...detail,
      config: { ...detail.config, coarse_spacing_m: null },
    })

    expect(parsed.config.coarse_spacing_m).toBeNull()
  })

  it('rejects a map without a positive size', () => {
    const bad = { ...detail, map: { ...detail.map, size_px: 0 } }

    expect(RunDetailSchema.safeParse(bad).success).toBe(false)
  })

  it('accepts an empty candidate list', () => {
    expect(
      RunDetailSchema.safeParse({ ...detail, candidates: [] }).success,
    ).toBe(true)
  })
})

describe('run list schema', () => {
  it('accepts an empty list (empty state)', () => {
    expect(RunListSchema.parse({ runs: [] }).runs).toEqual([])
  })
})

describe('paths', () => {
  it('validates run ids like the API does', () => {
    expect(isValidRunId('default')).toBe(true)
    expect(isValidRunId('a-b_C9')).toBe(true)
    expect(isValidRunId('../etc')).toBe(false)
    expect(isValidRunId('')).toBe(false)
    expect(isValidRunId('x'.repeat(65))).toBe(false)
  })

  it('builds the layer url under the API base', () => {
    expect(layerUrl('default', 'sun', '/api')).toBe(
      '/api/candidates/runs/default/layers/sun.png',
    )
    expect(() => runPath('bad id')).toThrow()
  })
})

describe('fetch helpers', () => {
  it('requests the contract paths', async () => {
    const seen: string[] = []
    const fetchFn = (input: string) => {
      seen.push(input)
      const body = input.endsWith('/runs') ? { runs: [] } : detail
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200 }),
      )
    }

    await fetchRuns({ baseUrl: '/api', fetchFn })
    await fetchRun('default', { baseUrl: '/api', fetchFn })

    expect(seen).toEqual([
      '/api/candidates/runs',
      '/api/candidates/runs/default',
    ])
  })

  it('surfaces a 404 with the detail message', async () => {
    const fetchFn = () =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'run not found' }), {
          status: 404,
        }),
      )

    await expect(
      fetchRun('nope', { baseUrl: '/api', fetchFn }),
    ).rejects.toThrow(/404.*run not found/)
  })
})

it('preserves regional terrain measurements and the applied slope threshold', () => {
  const terrain = {
    slope_p95_deg: 7.5,
    coverage_fraction: 1,
    assessment_radius_m: 250,
    slope_baseline_m: 160,
    roughness_window_m: 400,
    dem_pixel_m: 80,
    landing_safety_status: 'UNVERIFIED',
  }
  const parsed = RunDetailSchema.parse({
    ...detail,
    config: {
      ...detail.config,
      thresholds: {
        ...detail.config.thresholds,
        max_terrain_slope_degrees: 10,
      },
    },
    candidates: [{ ...candidate, terrain }],
  })
  expect(parsed.candidates[0]).toHaveProperty('terrain', terrain)
  expect(parsed.config.thresholds).toHaveProperty(
    'max_terrain_slope_degrees',
    10,
  )
})
