import { z } from 'zod'
import { getJson, type RequestOptions } from './client'

export const SiteAssessmentSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  step_minutes: z.number(),
  sun: z.object({
    visible_fraction: z.number(),
    longest_dark_hours: z.number(),
    windows_per_24h: z.number(),
    longest_visible_hours: z.number().nullable().optional(),
    transitions: z.number().nullable().optional(),
    clearance_p10_deg: z.number().nullable().optional(),
  }),
  earth: z.object({
    visible_fraction: z.number(),
    longest_dark_hours: z.number(),
    windows_per_24h: z.number(),
    longest_visible_hours: z.number().nullable().optional(),
    transitions: z.number().nullable().optional(),
    clearance_p10_deg: z.number().nullable().optional(),
  }),
  region: z.object({
    radius_m: z.number(),
    sample_step_m: z.number(),
    total_samples: z.number(),
    valid_samples: z.number(),
    coverage_fraction: z.number(),
    slope_p95_deg: z.number().nullable(),
    slope_max_deg: z.number().nullable(),
    roughness_p95_m: z.number().nullable(),
    landing_safety_status: z.string(),
  }),
  nominal_rf: z
    .object({
      available_fraction: z.number(),
      longest_unavailable_hours: z.number(),
      min_visible_margin_db: z.number().nullable(),
      earth_range_min_km: z.number(),
      earth_range_max_km: z.number(),
      limitation: z.string(),
    })
    .nullable()
    .optional(),
  terrain: z.object({
    elevation_m: z.number(),
    slope_deg: z.number(),
    roughness_rms_m: z.number(),
    slope_baseline_m: z.number(),
    roughness_window_m: z.number(),
    dem_pixel_m: z.number(),
    limitation: z.string(),
  }),
})

export type SiteAssessment = z.infer<typeof SiteAssessmentSchema>

export interface SiteAssessmentParams {
  lat: number
  lon: number
  start: string
  end: string
  step_minutes: number
}

export function fetchSiteAssessment(
  params: SiteAssessmentParams,
  options: RequestOptions = {},
): Promise<SiteAssessment> {
  const qs = new URLSearchParams({
    lat: String(params.lat),
    lon: String(params.lon),
    start: params.start,
    end: params.end,
    step_minutes: String(params.step_minutes),
  })
  return getJson(
    '/analysis/site-assessment?' + qs.toString(),
    SiteAssessmentSchema,
    options,
  )
}
