import type { PolarGridCell } from '../moon/location'

/** The single selection shared by the map and mission panels. All dates are UTC. */
export type MissionSelection = {
  departure: string
  landing: string
  duration: number
  siteId: string | null
}
export type CandidateSite = {
  id: string
  name: string
  latitude: number
  longitude: number
  sun: number | null
  earth: number | null
  longestDarkness: number | null
  slope: number | null
  grid?: PolarGridCell
  score?: number | null
}

export type Schedule = Pick<
  MissionSelection,
  'departure' | 'landing' | 'duration'
>
export type Timeline = {
  t: number[]
  sunEl: number[]
  sunHz: number[]
  earthEl: number[]
  earthHz: number[]
  sunVis: boolean[]
  earthVis: boolean[]
  sunPeriods: VisibilityPeriod[]
  earthPeriods: VisibilityPeriod[]
  start: string
  end: string
  stepMinutes: number
}
export type DateScore = {
  day: number
  duration: number
  xs: number[]
  ys: number[]
}

export type VisibilityPeriod = { start: number; end: number; on: boolean }
