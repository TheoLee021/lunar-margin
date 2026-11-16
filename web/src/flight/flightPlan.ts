import { createContext, useContext, useMemo } from 'react'
import { approachFromUrl } from './approach'
import type { FlightRequest } from './flightApi'
import type { Schedule } from '../mission/types'

export type FlightOverride = { key: string; request: FlightRequest }
export const FlightConditions = createContext<{
  override: FlightOverride | null
  apply: (value: FlightOverride) => void
}>({ override: null, apply: () => {} })

export function useFlightPlan(
  schedule: Schedule,
  site?: { latitude: number; longitude: number } | null,
) {
  const { override, apply } = useContext(FlightConditions)
  const approach = approachFromUrl(new URLSearchParams(window.location.search))
  const { departure, landing } = schedule
  const latitude = site?.latitude ?? approach.latitude
  const longitude = site?.longitude ?? approach.longitude
  const { durationS } = approach
  const initial = useMemo(
    () => ({
      departure,
      arrival: landing,
      latitude,
      longitude,
      durationS,
      alignmentToleranceM: 5000,
      wetMassKg: 1200,
      dryMassKg: 450,
      maxThrustN: 15000,
      ispS: 310,
    }),
    [departure, landing, latitude, longitude, durationS],
  )
  const key = JSON.stringify(initial)
  return {
    request: override?.key === key ? override.request : initial,
    apply: (request: FlightRequest) => apply({ key, request }),
  }
}

export function utc(value: string) {
  if (!Number.isFinite(Date.parse(value))) return '유효한 날짜를 선택하세요'
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
}
