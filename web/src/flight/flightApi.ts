import { ApiError, DEFAULT_BASE_URL } from '../api/client'
import {
  ExampleDescentSchema,
  FlightPreviewSchema,
  type FlightPreview,
} from './flightData'

export type FlightRequest = {
  departure: string
  arrival: string
  latitude: number
  longitude: number
  alignmentToleranceM: number
  durationS: number
  wetMassKg: number
  dryMassKg: number
  maxThrustN: number
  ispS: number
}

function waitForSolver(delay: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delay)
    function abort() {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

let lastPreview: { body: string; data: FlightPreview } | undefined

export async function requestFlightPreview(
  input: FlightRequest,
  signal?: AbortSignal,
) {
  const body = JSON.stringify({
    departure: `${input.departure}T00:00:00Z`,
    arrival: `${input.arrival}T00:00:00Z`,
    latitude: input.latitude,
    longitude: input.longitude,
    alignment_tolerance_m: input.alignmentToleranceM,
    duration_s: input.durationS,
    wet_mass_kg: input.wetMassKg,
    dry_mass_kg: input.dryMassKg,
    max_thrust_n: input.maxThrustN,
    isp_s: input.ispS,
  })
  signal?.throwIfAborted()
  if (lastPreview?.body === body) return lastPreview.data
  const delays = [1000, 2000, 4000, 8000, 8000]
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await loadPreview(body, signal)
      signal?.throwIfAborted()
      lastPreview = { body, data }
      return data
    } catch (error) {
      signal?.throwIfAborted()
      const transient =
        error instanceof TypeError ||
        (error instanceof ApiError && [429, 502, 504].includes(error.status))
      const delay = delays[attempt]
      if (!transient || delay === undefined) throw error
      await waitForSolver(delay, signal)
    }
  }
}

async function loadPreview(body: string, signal?: AbortSignal) {
  const response = await fetch(
    `${DEFAULT_BASE_URL}/trajectory/flight-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    },
  )
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    let detail = 'Reference flight calculation failed'
    if (payload && typeof payload === 'object' && 'detail' in payload) {
      const error = payload.detail
      if (typeof error === 'string') detail = error
    }
    throw new ApiError(detail, response.status)
  }
  const parsed = FlightPreviewSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new ApiError('Unexpected flight reference response shape', 200)
  }
  return parsed.data
}

export async function requestExample(
  input: FlightRequest,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${DEFAULT_BASE_URL}/trajectory/descent-reference`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        epoch_utc: input.arrival + 'T00:00:00Z',
        primary_site: { lat_deg: input.latitude, lon_deg: input.longitude },
        include_earth_los: false,
        vehicle: {
          wet_mass_kg: input.wetMassKg,
          dry_mass_kg: input.dryMassKg,
          max_thrust_n: input.maxThrustN,
          isp_s: input.ispS,
        },
      }),
    },
  )
  if (!response.ok)
    throw new Error(
      `Unable to calculate the example descent (HTTP ${response.status})`,
    )
  return ExampleDescentSchema.parse(await response.json()).results[0].path
}
