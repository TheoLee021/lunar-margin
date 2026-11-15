import { z } from 'zod'
import {
  ApiError,
  DEFAULT_BASE_URL,
  getJson,
  type RequestOptions,
} from './client'

const BookingSchema = z.object({
  id: z.uuid(),
  cell_id: z.string(),
  cell_ix: z.int(),
  cell_iy: z.int(),
  company: z.string(),
  mission_name: z.string(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  confirmed_at: z.iso.datetime({ offset: true }),
  status: z.enum(['confirmed', 'cancelled']),
  cancelled_at: z.iso.datetime({ offset: true }).nullable(),
})
export type Booking = z.infer<typeof BookingSchema>
const RegistrationSchema = z.object({
  company: z.string().trim().min(1).max(120),
  mission_name: z.string().trim().min(1).max(120),
  cell_ix: z.int().min(-610).max(610),
  cell_iy: z.int().min(-610).max(610),
  landing_date: z.iso.date(),
  mission_duration_days: z.int().min(1).max(365),
})
export type Registration = z.infer<typeof RegistrationSchema>
const CandidateAvailabilitySchema = z.object({
  candidate_id: z.string(),
  cell_id: z.string(),
  cell_ix: z.int(),
  cell_iy: z.int(),
  status: z.enum(['available', 'reserved']),
  available_rank: z.int().positive().nullable(),
  conflicts: z.array(BookingSchema),
})
export type CandidateAvailability = z.infer<typeof CandidateAvailabilitySchema>
const AvailabilitySchema = z.object({
  run_id: z.string(),
  checked_at: z.iso.datetime({ offset: true }),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  candidates: z.array(CandidateAvailabilitySchema),
})
export type Availability = z.infer<typeof AvailabilitySchema>

export function fetchAvailability(runId: string, options?: RequestOptions) {
  return getJson(
    `/candidates/runs/${encodeURIComponent(runId)}/availability`,
    AvailabilitySchema,
    options,
  )
}

async function reservationRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  body: Registration | null,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch, signal }: RequestOptions = {},
  method: 'GET' | 'POST' = 'POST',
): Promise<T> {
  const response = await fetchFn(`${baseUrl}${path}`, {
    method,
    signal,
    cache: 'no-store',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    /* proxy may return HTML */
  }
  if (!response.ok) {
    const detail = z.object({ detail: z.string() }).safeParse(data)
    throw new ApiError(
      detail.success
        ? detail.data.detail
        : `예약 요청 실패 (${response.status})`,
      response.status,
    )
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success)
    throw new ApiError('예약 응답 형식이 올바르지 않습니다', response.status)
  return parsed.data
}

export function confirmReservation(
  body: Registration,
  options?: RequestOptions,
) {
  return reservationRequest(
    '/reservations',
    BookingSchema,
    RegistrationSchema.parse(body),
    options,
  )
}
export function cancelReservation(id: string, options?: RequestOptions) {
  return reservationRequest(
    `/reservations/${encodeURIComponent(id)}/cancel`,
    BookingSchema,
    null,
    options,
  )
}
export function fetchReservations(offset = 0, options?: RequestOptions) {
  return reservationRequest(
    `/reservations?limit=100&offset=${offset}`,
    z.object({ reservations: z.array(BookingSchema) }),
    null,
    options,
    'GET',
  )
}
