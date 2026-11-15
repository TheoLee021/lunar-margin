import { z } from 'zod'
import { ApiError, DEFAULT_BASE_URL, type RequestOptions } from './client'
import { CalendarInputSchema, DeliverySchema } from './pricing'

const Amount = z.number().nonnegative()
export const ProviderIdSchema = z.enum([
  'blue_origin',
  'ispace_us',
  'spacex',
  'lockheed_martin',
  'northrop_grumman',
  'voyager',
])
const Source = z.object({
  title: z.string(),
  url: z.url(),
  published_date: z.iso.date().nullable(),
})
const Schedule = z.object({
  label: z.string(),
  precision: z.enum([
    'unknown',
    'year',
    'month',
    'day',
    'window',
    'not_before',
  ]),
  start: z.iso.date().nullable(),
  end: z.iso.date().nullable(),
  confirmed: z.boolean(),
})
export const IssueSchema = z.enum([
  'mission_unpublished',
  'schedule_unknown',
  'outside_schedule',
  'transit_out_of_range',
  'delivery_unknown',
  'delivery_unserved',
  'capacity_unknown',
  'capacity_exceeded',
  'destination_unknown',
  'destination_unserved',
  'price_unpublished',
  'pricing_terms_unknown',
  'terrain_excluded',
])
export type ProviderIssue = z.infer<typeof IssueSchema>
const FlightOffer = z
  .object({
    mission_id: z.string(),
    name: z.string(),
    vehicle: z.string().nullable(),
    departure: Schedule,
    arrival: Schedule,
    tariff_usd_per_kg: Amount.nullable(),
    fixed_usd: Amount.nullable().optional().default(null),
    minimum_billable_kg: Amount.nullable().optional().default(null),
    billing_increment_kg: Amount.nullable().optional().default(null),
    maximum_payload_kg: Amount.nullable(),
    available_payload_kg: Amount.nullable(),
    issues: z.array(IssueSchema),
    sources: z.array(Source).min(1),
    price_usd: Amount.nullable(),
    price_grade: z.literal('modeled_from_published_terms').nullable(),
  })
  .refine(
    (f) =>
      f.price_usd === null
        ? f.price_grade === null
        : f.issues.length === 0 &&
          f.price_grade !== null &&
          f.tariff_usd_per_kg !== null,
    'Unqualified provider quote',
  )
const ProviderOffer = z
  .object({
    provider_id: ProviderIdSchema,
    name: z.string(),
    source: Source,
    issues: z.array(IssueSchema),
    flights: z.array(FlightOffer),
    minimum_usd: Amount.nullable(),
  })
  .refine((p) => {
    const prices = p.flights.flatMap((f) =>
      f.price_usd === null ? [] : [f.price_usd],
    )
    return p.minimum_usd === (prices.length ? Math.min(...prices) : null)
  }, 'Inconsistent company minimum')
export type ProviderOffer = z.infer<typeof ProviderOffer>
export const CompareInputSchema = z.object({
  departure_date: z.iso.date(),
  landing_date: z.iso.date(),
  mass_kg: z.number().positive().max(1000000),
  delivery: DeliverySchema,
  x_m: z.number().min(-350000).max(350000),
  y_m: z.number().min(-350000).max(350000),
})
export type CompareInput = z.infer<typeof CompareInputSchema>
export const ComparisonSchema = CompareInputSchema.extend({
  catalog_checked_on: z.iso.date(),
  minimum_usd: Amount.nullable(),
  providers: z.array(ProviderOffer).length(6),
  destination_multiplier: z.number().min(1).max(1.3).nullable(),
  terrain_unknown: z.boolean().nullable(),
  demand_multiplier: z.literal(1),
  demand_unknown: z.literal(true),
}).refine(
  (r) =>
    new Set(r.providers.map((p) => p.provider_id)).size === 6 &&
    r.minimum_usd ===
      (r.providers.some((p) => p.minimum_usd !== null)
        ? Math.min(
            ...r.providers.flatMap((p) =>
              p.minimum_usd === null ? [] : [p.minimum_usd],
            ),
          )
        : null),
  'Inconsistent six-company comparison',
)
export type Comparison = z.infer<typeof ComparisonSchema>
export const ProviderCalendarInputSchema = CalendarInputSchema.extend({
  departure_dates: z.array(z.iso.date()).min(1).max(5),
  source_run_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,120}$/)
    .nullable()
    .optional(),
})
export type ProviderCalendarInput = z.infer<typeof ProviderCalendarInputSchema>
const CalendarCell = z
  .object({
    departure_date: z.iso.date(),
    landing_date: z.iso.date(),
    run_id: z.string(),
    status: z.enum([
      'no_published_quote',
      'search_required',
      'quoted',
      'partial_coverage',
      'no_eligible',
      'invalid_transit',
      'unavailable',
    ]),
    mean_min_usd: Amount.nullable(),
    eligible_grid_count: z.number().int().nonnegative().nullable(),
    terrain_unknown_count: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .default(null),
    quoted_grid_count: z.number().int().nonnegative(),
    eligible_provider_ids: z.array(ProviderIdSchema),
  })
  .refine(
    (c) =>
      c.status === 'quoted'
        ? c.mean_min_usd !== null &&
          c.eligible_grid_count !== null &&
          c.eligible_grid_count > 0 &&
          c.quoted_grid_count === c.eligible_grid_count &&
          c.eligible_provider_ids.length > 0
        : c.mean_min_usd === null,
    'A partial or unknown quote cannot become a full-grid average',
  )
export const ProviderCalendarSchema = z.object({
  catalog_checked_on: z.iso.date(),
  mass_kg: z.number().positive(),
  delivery: DeliverySchema,
  mission_duration_days: z.number().int().positive(),
  dates: z.array(
    z.object({
      landing_date: z.iso.date(),
      run_id: z.string(),
      state: z.enum([
        'completed',
        'not_computed',
        'running',
        'failed',
        'unavailable',
      ]),
      message: z.string().nullable(),
    }),
  ),
  cells: z.array(CalendarCell),
  aggregation: z.literal('mean_of_grid_minima'),
  sampling: z.literal('all_eligible_500m_grids'),
})
export type ProviderCalendar = z.infer<typeof ProviderCalendarSchema>
export type ProviderCalendarCell = ProviderCalendar['cells'][number]

async function post<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch, signal }: RequestOptions = {},
): Promise<T> {
  const response = await fetchFn(`${baseUrl}/pricing/providers/${path}`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok)
    throw new ApiError(
      `회사별 가격을 불러오지 못했습니다 (${response.status}). ${await response.text()}`,
      response.status,
    )
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success)
    throw new ApiError(
      '회사별 가격 응답 형식이 올바르지 않습니다.',
      response.status,
    )
  return parsed.data
}
export async function fetchProviderCalendar(
  input: ProviderCalendarInput,
  options?: RequestOptions,
) {
  const request = ProviderCalendarInputSchema.parse(input)
  const result = await post(
    'calendar',
    request,
    ProviderCalendarSchema,
    options,
  )
  const slots = new Set(
    result.cells.map((c) => `${c.departure_date}/${c.landing_date}`),
  )
  if (
    result.mass_kg !== request.mass_kg ||
    result.delivery !== request.delivery ||
    result.mission_duration_days !== request.mission.mission_duration_days ||
    result.dates.length !== request.landing_dates.length ||
    result.dates.some((r, i) => r.landing_date !== request.landing_dates[i]) ||
    result.cells.length !==
      request.departure_dates.length * request.landing_dates.length ||
    slots.size !== result.cells.length ||
    request.departure_dates.some((d) =>
      request.landing_dates.some((l) => !slots.has(`${d}/${l}`)),
    ) ||
    result.cells.some(
      (c) =>
        result.dates.find((d) => d.landing_date === c.landing_date)?.run_id !==
        c.run_id,
    )
  )
    throw new ApiError(
      '회사별 가격 응답의 일정·화물이 요청과 일치하지 않습니다.',
      200,
    )
  return result
}
export async function fetchProviderComparison(
  input: CompareInput,
  options?: RequestOptions,
) {
  const request = CompareInputSchema.parse(input)
  const result = await post('compare', request, ComparisonSchema, options)
  if (
    result.departure_date !== request.departure_date ||
    result.landing_date !== request.landing_date ||
    result.mass_kg !== request.mass_kg ||
    result.delivery !== request.delivery ||
    result.x_m !== request.x_m ||
    result.y_m !== request.y_m
  )
    throw new ApiError(
      '회사별 가격 응답의 격자·일정·화물이 요청과 일치하지 않습니다.',
      200,
    )
  return result
}
