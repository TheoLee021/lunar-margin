import { describe, expect, it } from 'vitest'
import { fetchLandingGrid, LandingGridSchema } from './landingGrid'

const result = {
  lat: -89.5,
  lon: 222,
  assessment_radius_m: 250,
  target_radius_m: 50,
  sample_step_m: 80,
  slope_baseline_m: 160,
  roughness_window_m: 400,
  max_slope_deg: 10,
  max_roughness_m: null,
  total_target_centers: 1,
  passing_target_centers: 0,
  cells: [
    {
      dx_m: 0,
      dy_m: 0,
      slope_deg: null,
      roughness_rms_m: null,
      valid: false,
      in_assessment_circle: true,
    },
  ],
  targets: [
    {
      dx_m: 0,
      dy_m: 0,
      lat_deg: -89.5,
      lon_deg: 222,
      cells_intersecting: 1,
      valid_cells: 0,
      coverage_fraction: 0,
      slope_p95_deg: null,
      slope_max_deg: null,
      roughness_max_m: null,
      terrain_screen_pass: false,
      reasons: ['terrain_incomplete'],
    },
  ],
  best_target: null,
  landing_safety_status: 'UNVERIFIED',
  limitation: 'DEM-scale screening only',
}

describe('landing grid API', () => {
  it('keeps missing terrain as null and no screened target', () => {
    const parsed = LandingGridSchema.parse(result)
    expect(parsed.best_target).toBeNull()
    expect(parsed.cells[0]?.slope_deg).toBeNull()
    expect(parsed.targets[0]?.terrain_screen_pass).toBe(false)
  })

  it('rejects a misleading safe/certified state', () => {
    expect(
      LandingGridSchema.safeParse({
        ...result,
        landing_safety_status: 'SAFE',
      }).success,
    ).toBe(false)
  })

  it('requests a site-specific local grid only when invoked', async () => {
    const fetchFn = async (url: string) => {
      expect(url).toContain('lat=-89.5')
      expect(url).toContain('max_slope_deg=7')
      return new Response(JSON.stringify(result), { status: 200 })
    }
    const value = await fetchLandingGrid(-89.5, 222, 7, {
      baseUrl: '/api',
      fetchFn,
    })
    expect(value.best_target).toBeNull()
  })
})
