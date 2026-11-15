import { z } from 'zod'
import { ApiError, DEFAULT_BASE_URL, type RequestOptions } from './client'
import { ProviderIdSchema } from './providerPricing'

export const LaunchScheduleSchema = z.object({
  timezone: z.literal('UTC'),
  launches: z.array(
    z.object({
      id: z.string(),
      provider_id: ProviderIdSchema.nullable(),
      launch_provider: z.string().optional().default('발사사 미정'),
      lunar_related: z.boolean().optional().default(true),
      name: z.string(),
      departure_date: z.iso.date().nullable(),
      label: z.string(),
      confirmed: z.literal(false),
      date_precision: z
        .enum(['day', 'month', 'year', 'quarter', 'unknown'])
        .optional()
        .default('unknown'),
      participants: z
        .array(
          z.object({
            provider_id: ProviderIdSchema,
            role: z.enum(['delivery', 'launch', 'partner']),
          }),
        )
        .optional()
        .default([]),
      sources: z
        .array(z.object({ name: z.string(), url: z.url(), label: z.string() }))
        .min(1),
    }),
  ),
  sources: z.array(
    z.object({
      name: z.string(),
      url: z.url(),
      fetched_at: z.iso.datetime({ offset: true }),
      stale: z.boolean(),
      error: z.string().nullable(),
      scanned_records: z.number().int().nonnegative().optional().default(0),
      scanned_pages: z.number().int().nonnegative().optional().default(0),
      complete: z.boolean().optional().default(true),
    }),
  ),
})
export type LaunchSchedule = z.infer<typeof LaunchScheduleSchema>
export async function fetchLaunchSchedule({
  baseUrl = DEFAULT_BASE_URL,
  fetchFn = fetch,
  signal,
}: RequestOptions = {}) {
  const response = await fetchFn(`${baseUrl}/pricing/providers/launches`, {
    signal,
  })
  if (!response.ok)
    throw new ApiError(
      `발사 일정을 불러오지 못했습니다 (${response.status}).`,
      response.status,
    )
  const parsed = LaunchScheduleSchema.safeParse(await response.json())
  if (!parsed.success)
    throw new ApiError(
      '발사 일정 응답 형식이 올바르지 않습니다.',
      response.status,
    )
  return parsed.data
}

/** Published exact days only; missing/incomplete data never implies an available flight. */
export function departureAvailability(
  data: LaunchSchedule | null,
  error: string,
  launchId: string | null | undefined,
  departure: string,
): 'scheduled' | 'no_launch' | 'unknown' | 'loading' {
  if (!data) return error ? 'unknown' : 'loading'
  if (launchId) {
    const selected = data.launches.find((launch) => launch.id === launchId)
    if (!selected?.departure_date) return 'unknown'
    return selected.departure_date === departure ? 'scheduled' : 'no_launch'
  }
  if (data.launches.some((launch) => launch.departure_date === departure))
    return 'scheduled'
  return data.sources.every((source) => source.complete && !source.stale)
    ? 'no_launch'
    : 'unknown'
}
