import { z } from 'zod'
import { getJson, type RequestOptions } from './client'

// 응답 스키마는 docs/api.md 의 /analysis/* 와 일치해야 한다.
export type AnalysisKind = 'illumination' | 'earth-visibility'

const PeriodSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
})

export const AnalysisSchema = z
  .object({
    lat: z.number(),
    lon: z.number(),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    step_minutes: z.number(),
    observer_height_m: z.number(),
    metrics: z.object({
      visible_fraction: z.number(),
      longest_dark_hours: z.number(),
      windows_per_24h: z.number(),
      mean_elevation_deg: z.number().nullable(),
    }),
    horizon: z.object({
      azimuth_deg: z.array(z.number()),
      elevation_deg: z.array(z.number()),
    }),
    series: z.object({
      times: z.array(z.iso.datetime({ offset: true })),
      body_azimuth_deg: z.array(z.number()),
      body_elevation_deg: z.array(z.number()),
      visible: z.array(z.boolean()),
    }),
    windows: z.array(PeriodSchema),
    dark_periods: z.array(PeriodSchema),
  })
  .refine(
    ({ horizon, series }) =>
      horizon.azimuth_deg.length === horizon.elevation_deg.length &&
      series.times.length === series.body_azimuth_deg.length &&
      series.times.length === series.body_elevation_deg.length &&
      series.times.length === series.visible.length,
    { message: 'array lengths do not match' },
  )

export type Analysis = z.infer<typeof AnalysisSchema>
export type Period = z.infer<typeof PeriodSchema>

export interface AnalysisParams {
  lat: number
  lon: number
  start: string
  end: string
  step_minutes: number
  observer_height_m: number
}

export function buildAnalysisPath(
  kind: AnalysisKind,
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
