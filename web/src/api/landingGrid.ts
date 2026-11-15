import { z } from 'zod'
import { getJson, type RequestOptions } from './client'

const CellSchema = z.object({
  dx_m: z.number(),
  dy_m: z.number(),
  slope_deg: z.number().nullable(),
  roughness_rms_m: z.number().nullable(),
  valid: z.boolean(),
  in_assessment_circle: z.boolean(),
})

const TargetSchema = z.object({
  dx_m: z.number(),
  dy_m: z.number(),
  lat_deg: z.number(),
  lon_deg: z.number(),
  cells_intersecting: z.number(),
  valid_cells: z.number(),
  coverage_fraction: z.number(),
  slope_p95_deg: z.number().nullable(),
  slope_max_deg: z.number().nullable(),
  roughness_max_m: z.number().nullable(),
  terrain_screen_pass: z.boolean(),
  reasons: z.array(z.string()),
})

export const LandingGridSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  assessment_radius_m: z.number(),
  target_radius_m: z.number(),
  sample_step_m: z.number(),
  slope_baseline_m: z.number(),
  roughness_window_m: z.number(),
  max_slope_deg: z.number(),
  max_roughness_m: z.number().nullable(),
  total_target_centers: z.number(),
  passing_target_centers: z.number(),
  cells: z.array(CellSchema),
  targets: z.array(TargetSchema),
  best_target: TargetSchema.nullable(),
  landing_safety_status: z.literal('UNVERIFIED'),
  limitation: z.string(),
})

export type LandingGrid = z.infer<typeof LandingGridSchema>

export function fetchLandingGrid(
  lat: number,
  lon: number,
  maxSlopeDeg: number,
  options: RequestOptions = {},
): Promise<LandingGrid> {
  const qs = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    max_slope_deg: String(maxSlopeDeg),
  })
  return getJson(
    '/analysis/landing-grid?' + qs.toString(),
    LandingGridSchema,
    options,
  )
}
