import { z } from 'zod'
import { TerrainSchema } from './candidates'
import { getJson, type RequestOptions } from './client'

// 응답 스키마는 docs/api.md 의 /analysis/* 와 일치해야 한다.
export type AnalysisKind = 'illumination' | 'earth-visibility'

const PeriodSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
})

const MetricsSchema = z.object({
  visible_fraction: z.number(),
  longest_dark_hours: z.number(),
  windows_per_24h: z.number(),
  mean_elevation_deg: z.number().nullable(),
})

export const AnalysisSchema = z
  .object({
    lat: z.number(),
    lon: z.number(),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    step_minutes: z.number(),
    observer_height_m: z.number(),
    metrics: MetricsSchema,
    horizon: z.object({
      azimuth_deg: z.array(z.number()),
      elevation_deg: z.array(z.number()),
    }),
    series: z.object({
      times: z.array(z.iso.datetime({ offset: true })),
      body_azimuth_deg: z.array(z.number()),
      body_elevation_deg: z.array(z.number()),
      visible: z.array(z.boolean()),
      terrain_clearance_deg: z.array(z.number()).nullable().optional(),
    }),
    visible_clearance_p10_deg: z.number().nonnegative().nullable().optional(),
    windows: z.array(PeriodSchema),
    dark_periods: z.array(PeriodSchema),
  })
  .refine(
    ({ horizon, series }) =>
      horizon.azimuth_deg.length === horizon.elevation_deg.length &&
      series.times.length === series.body_azimuth_deg.length &&
      series.times.length === series.body_elevation_deg.length &&
      series.times.length === series.visible.length &&
      (series.terrain_clearance_deg == null ||
        series.times.length === series.terrain_clearance_deg.length),
    { message: 'array lengths do not match' },
  )

export type Analysis = z.infer<typeof AnalysisSchema>
export type Period = z.infer<typeof PeriodSchema>

// 후보 비교용 요약: 위 두 분석의 metrics 와 후보 탐색과 같은 지역 지형
export const SiteAssessmentSchema = z.object({
  terrain_clearance: z
    .object({
      sun_visible_p10_deg: z.number().nonnegative().nullable(),
      earth_visible_p10_deg: z.number().nonnegative().nullable(),
    })
    .nullable()
    .optional(),
  solar_continuity: z
    .object({
      longest_sun_visible_hours: z.number().nonnegative(),
      visibility_transitions: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
  lat: z.number(),
  lon: z.number(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  step_minutes: z.number(),
  observer_height_m: z.number(),
  sun: MetricsSchema,
  earth: MetricsSchema,
  terrain: TerrainSchema,
})
export type SiteAssessment = z.infer<typeof SiteAssessmentSchema>

export interface AnalysisParams {
  lat: number
  lon: number
  start: string
  end: string
  step_minutes: number
  observer_height_m: number
}

export function buildAnalysisPath(
  kind: AnalysisKind | 'site-assessment',
  params: AnalysisParams,
): string {
  const query = new URLSearchParams({
    lat: String(params.lat),
    lon: String(params.lon),
    start: params.start,
    end: params.end,
    step_minutes: String(params.step_minutes),
    observer_height_m: String(params.observer_height_m),
  })
  return `/analysis/${kind}?${query.toString()}`
}

export function fetchAnalysis(
  kind: AnalysisKind,
  params: AnalysisParams,
  signal?: AbortSignal,
  options: Omit<RequestOptions, 'signal'> = {},
): Promise<Analysis> {
  return getJson(buildAnalysisPath(kind, params), AnalysisSchema, {
    ...options,
    signal,
  })
}

export function fetchSiteAssessment(
  params: AnalysisParams,
  signal?: AbortSignal,
  options: Omit<RequestOptions, 'signal'> = {},
): Promise<SiteAssessment> {
  return getJson(
    buildAnalysisPath('site-assessment', params),
    SiteAssessmentSchema,
    { ...options, signal },
  )
}
