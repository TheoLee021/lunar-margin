import { describe, expect, it } from 'vitest'
import {
  AnalysisSchema,
  SiteAssessmentSchema,
  buildAnalysisPath,
  fetchAnalysis,
  fetchSiteAssessment,
  type AnalysisParams,
} from './analysis'

const params: AnalysisParams = {
  lat: -89.7,
  lon: 130,
  start: '2027-01-01T00:00:00Z',
  end: '2027-01-02T00:00:00Z',
  step_minutes: 30,
  observer_height_m: 0,
}

// docs/api.md 의 예시 응답과 같은 형태
function sample() {
  return {
    ...params,
    metrics: {
      visible_fraction: 0.42,
      longest_dark_hours: 96.5,
      windows_per_24h: 0.9,
      mean_elevation_deg: 0.8,
    },
    horizon: { azimuth_deg: [0, 1, 2], elevation_deg: [1.2, 1.3, 1.1] },
    series: {
      times: ['2027-01-01T00:00:00Z', '2027-01-01T00:30:00Z'],
      body_azimuth_deg: [212.4, 213.1],
      body_elevation_deg: [0.7, 0.9],
      visible: [true, false],
    },
    windows: [{ start: '2027-01-01T00:00:00Z', end: '2027-01-01T00:30:00Z' }],
    dark_periods: [
      { start: '2027-01-01T00:30:00Z', end: '2027-01-02T00:00:00Z' },
    ],
  }
}

describe('AnalysisSchema', () => {
  it('accepts the documented response', () => {
    expect(AnalysisSchema.safeParse(sample()).success).toBe(true)
  })

  it('accepts null mean_elevation_deg (no visible period)', () => {
    const body = sample()
    body.metrics.mean_elevation_deg = null as unknown as number
    expect(AnalysisSchema.safeParse(body).success).toBe(true)
  })

  it('accepts +00:00 offsets', () => {
    const body = sample()
    body.start = '2027-01-01T00:00:00+00:00'
    expect(AnalysisSchema.safeParse(body).success).toBe(true)
  })

  it('rejects series arrays of different lengths', () => {
    const body = sample()
    body.series.visible = [true]
    expect(AnalysisSchema.safeParse(body).success).toBe(false)
  })

  it('rejects a missing metrics field', () => {
    const { metrics: _metrics, ...rest } = sample()
    expect(AnalysisSchema.safeParse(rest).success).toBe(false)
  })
})

describe('buildAnalysisPath', () => {
  it('encodes all query parameters', () => {
    const path = buildAnalysisPath('earth-visibility', params)
    expect(path.startsWith('/analysis/earth-visibility?')).toBe(true)
    const query = new URLSearchParams(path.split('?')[1])
    expect(query.get('lat')).toBe('-89.7')
    expect(query.get('start')).toBe('2027-01-01T00:00:00Z')
    expect(query.get('step_minutes')).toBe('30')
    expect(query.get('observer_height_m')).toBe('0')
  })
})

describe('fetchAnalysis', () => {
  it('includes the FastAPI detail in the error message on 422', async () => {
    const fetchFn = () =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'end must be after start' }), {
          status: 422,
        }),
      )
    await expect(
      fetchAnalysis('illumination', params, undefined, {
        baseUrl: '/api',
        fetchFn,
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      message: expect.stringContaining('end must be after start'),
    })
  })
})

// docs/api.md 의 GET /analysis/site-assessment 예시와 같은 형태
function assessment() {
  return {
    ...params,
    sun: {
      visible_fraction: 0.42,
      longest_dark_hours: 96.5,
      windows_per_24h: 0.9,
      mean_elevation_deg: 0.8,
    },
    earth: {
      visible_fraction: 0.88,
      longest_dark_hours: 40,
      windows_per_24h: 0.07,
      mean_elevation_deg: null,
    },
    terrain: {
      slope_p95_deg: 6.1,
      coverage_fraction: 1,
      assessment_radius_m: 250,
      slope_baseline_m: 160,
      roughness_window_m: 400,
      dem_pixel_m: 80,
      landing_safety_status: 'UNVERIFIED',
    },
  }
}

describe('SiteAssessmentSchema', () => {
  it('accepts the documented response', () => {
    expect(SiteAssessmentSchema.safeParse(assessment()).success).toBe(true)
  })

  it('rejects a terrain coverage above 1', () => {
    const body = assessment()
    body.terrain.coverage_fraction = 1.5
    expect(SiteAssessmentSchema.safeParse(body).success).toBe(false)
  })
})

describe('fetchSiteAssessment', () => {
  it('requests the site assessment path and parses the body', async () => {
    const urls: string[] = []
    const fetchFn = (input: RequestInfo | URL) => {
      urls.push(String(input))
      return Promise.resolve(new Response(JSON.stringify(assessment())))
    }
    const result = await fetchSiteAssessment(params, undefined, {
      baseUrl: '/api',
      fetchFn,
    })
    expect(urls[0]).toMatch(/^\/api\/analysis\/site-assessment\?lat=-89.7&/)
    expect(result.terrain.slope_p95_deg).toBe(6.1)
  })
})
