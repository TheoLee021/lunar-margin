import { z } from 'zod'
import {
  ApiError,
  DEFAULT_BASE_URL,
  getJson,
  type RequestOptions,
} from './client'
import {
  MissionRequestSchema,
  runPath,
  fetchRunStatus,
  type RunStatus,
} from './candidates'

export const DeliverySchema = z.enum(['orbit', 'surface', 'rover_delivery'])
export type Delivery = z.infer<typeof DeliverySchema>
const Amount = z.number().nonnegative()
export const PriceSchema = z
  .object({
    baseline_usd: Amount,
    transport_usd: Amount,
    destination_adjustment_usd: Amount,
    demand_adjustment_usd: Amount,
    fixed_usd: Amount,
    adjusted_usd: Amount,
    range_low_usd: Amount,
    range_high_usd: Amount,
    destination_multiplier: z.number().min(1).max(1.3),
    demand_multiplier: z.number().min(1).max(1.4),
    destination_unknown: z.boolean(),
    demand_unknown: z.boolean(),
    grade: z.literal('modeled'),
  })
  .refine(
    (p) =>
      Math.abs(
        p.adjusted_usd -
          p.fixed_usd -
          p.transport_usd -
          p.destination_adjustment_usd -
          p.demand_adjustment_usd,
      ) < 0.01 &&
      p.range_low_usd <= p.adjusted_usd &&
      p.range_high_usd >= p.adjusted_usd,
    'Inconsistent price audit trail',
  )
export type Price = z.infer<typeof PriceSchema>
const Counts = z.object({
  fine: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
  priced: z.number().int().nonnegative(),
  terrain_excluded: z.number().int().nonnegative(),
  terrain_unknown: z.number().int().nonnegative(),
  unevaluated: z.number().int().nonnegative(),
  coarse_ignored: z.number().int().nonnegative(),
})
export const RunPricesSchema = z
  .object({
    run_id: z.string(),
    landing_date: z.iso.date(),
    mission_duration_days: z.number().int().positive(),
    grid_spacing_m: z.literal(500),
    slope_policy: z
      .object({
        basis: z.literal('saved_search_eligibility'),
        max_slope_degrees: z.number().positive().max(90).nullable(),
        statistic: z.literal('p95'),
        assessment_radius_m: z.number().positive(),
        slope_baseline_m: z.number().positive(),
      })
      .nullable()
      .optional(),
    counts: Counts,
    mean: PriceSchema.nullable(),
    cells: z.array(
      z.object({
        id: z.string(),
        x_m: z.number(),
        y_m: z.number(),
        landable_fraction: z.number().min(0).max(1).nullable(),
        aim_slope_deg: z.number().nullable(),
        price: PriceSchema.nullable(),
        excluded_reason: z.string().nullable(),
      }),
    ),
  })
  .refine(
    (p) =>
      p.counts.priced + p.counts.terrain_excluded === p.counts.eligible &&
      p.counts.eligible <= p.counts.fine &&
      (p.mean !== null) === p.counts.priced > 0,
    'Inconsistent grid counts',
  )
export type RunPrices = z.infer<typeof RunPricesSchema>
const CalendarDateSchema = z
  .object({
    landing_date: z.iso.date(),
    run_id: z.string(),
    state: z.enum([
      'ready',
      'no_eligible',
      'not_computed',
      'running',
      'failed',
      'unavailable',
    ]),
    message: z.string().nullable(),
    pricing: RunPricesSchema.nullable(),
  })
  .refine((row) =>
    row.state === 'ready'
      ? row.pricing?.mean != null
      : row.state === 'no_eligible'
        ? row.pricing !== null && row.pricing.mean === null
        : row.pricing === null,
  )
export const CalendarSchema = z.object({
  mass_kg: z.number().positive(),
  delivery: DeliverySchema,
  tariff_usd_per_kg: Amount,
  dates: z.array(CalendarDateSchema),
  evidence: z.array(
    z.object({
      term: z.string(),
      value: z.string(),
      grade: z.string(),
      source: z.string().nullable(),
      note: z.string(),
    }),
  ),
})
export type Calendar = z.infer<typeof CalendarSchema>
export type CalendarDate = Calendar['dates'][number]
export const CalendarInputSchema = z.object({
  mission: MissionRequestSchema,
  landing_dates: z.array(z.iso.date()).min(1).max(5),
  mass_kg: z.number().positive().max(1_000_000),
  delivery: DeliverySchema,
})
export type CalendarInput = z.infer<typeof CalendarInputSchema>

const CalendarStartedSchema = z.object({
  run_ids: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
    .min(1)
    .max(5),
  state: z.enum(['queued', 'running', 'done']),
  cached: z.boolean(),
})

const BusyCalendarSchema = z.object({
  detail: z.object({
    message: z.string(),
    running_run_id: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
  }),
})

function waitForWorker(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, 1000)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Preserve the requested dates while an unrelated worker holds the search lock. */
export async function startCalendar(
  input: CalendarInput,
  {
    baseUrl = DEFAULT_BASE_URL,
    fetchFn = fetch,
    signal,
    onBusy,
  }: RequestOptions & {
    onBusy?: (status: RunStatus | null) => void
  } = {},
) {
  const body = JSON.stringify(CalendarInputSchema.parse(input))
  try {
    while (true) {
      signal?.throwIfAborted()
      const response = await fetchFn(`${baseUrl}/pricing/calculate`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body,
      })
      if (response.status === 409) {
        const busy = BusyCalendarSchema.safeParse(
          await response.json().catch(() => null),
        )
        if (!busy.success)
          throw new ApiError(
            '다른 탐색의 대기 상태를 확인하지 못했습니다.',
            409,
          )
        const runId = busy.data.detail.running_run_id
        while (true) {
          const status = await fetchRunStatus(runId, {
            baseUrl,
            fetchFn,
            signal,
          })
          if (status.run_id !== runId)
            throw new ApiError(
              '대기 중인 탐색 응답이 요청과 일치하지 않습니다.',
              200,
            )
          if (status.state !== 'running' && status.state !== 'queued') break
          onBusy?.(status)
          await waitForWorker(signal)
        }
        onBusy?.(null)
        continue
      }
      if (!response.ok)
        throw new ApiError(
          `날짜별 일괄 계산을 시작하지 못했습니다 (${response.status}). ${await response.text()}`,
          response.status,
        )
      const result = CalendarStartedSchema.parse(await response.json())
      if (
        result.run_ids.length !== input.landing_dates.length ||
        new Set(result.run_ids).size !== result.run_ids.length
      )
        throw new ApiError(
          '일괄 계산 응답의 날짜 개수가 요청과 일치하지 않습니다.',
          response.status,
        )
      return result
    }
  } finally {
    onBusy?.(null)
  }
}

export async function fetchCalendar(
  input: CalendarInput,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch, signal }: RequestOptions = {},
): Promise<Calendar> {
  const request = CalendarInputSchema.parse(input)
  const response = await fetchFn(`${baseUrl}/pricing/calendar`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok)
    throw new ApiError(
      `가격 계산을 불러오지 못했습니다 (${response.status}). ${await response.text()}`,
      response.status,
    )
  const result = CalendarSchema.parse(await response.json())
  if (
    result.mass_kg !== request.mass_kg ||
    result.delivery !== request.delivery ||
    result.dates.length !== request.landing_dates.length ||
    result.dates.some(
      (row, i) =>
        row.landing_date !== request.landing_dates[i] ||
        (row.pricing !== null &&
          (row.pricing.run_id !== row.run_id ||
            row.pricing.landing_date !== row.landing_date ||
            row.pricing.mission_duration_days !==
              request.mission.mission_duration_days)),
    )
  )
    throw new ApiError(
      '가격 응답의 날짜·화물·임무 기간이 요청과 일치하지 않습니다.',
      response.status,
    )
  return result
}

export async function fetchGridPrices(
  runId: string,
  mass: number,
  delivery: Delivery,
  options?: RequestOptions,
) {
  runPath(runId) // Validate the identifier using the shared contract.
  const result = await getJson(
    `/pricing/runs/${runId}?mass_kg=${mass}&delivery=${delivery}&include_cells=true`,
    RunPricesSchema,
    options,
  )
  if (result.run_id !== runId)
    throw new ApiError('가격 응답의 탐색 실행이 요청과 일치하지 않습니다.', 200)
  return result
}

export function formatPrice(usd: number): string {
  const million = Number((usd / 1_000_000).toPrecision(2))
  return `$${million.toLocaleString('en-US', { maximumSignificantDigits: 2 })}M`
}

export function isTransitPossible(departure: string, landing: string): boolean {
  const days = (Date.parse(landing) - Date.parse(departure)) / 86_400_000
  return days >= 3 && days <= 150
}
