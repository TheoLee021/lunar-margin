/** The single selection shared by the map and mission panels. All dates are UTC. */
export type MissionSelection = {
  departure: string
  landing: string
  duration: number
  siteId: string
}
export type CandidateSite = {
  id: string
  name: string
  latitude: number
  longitude: number
  sun: number
  earth: number
  longestDarkness: number
  slope: number
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
  longest: number
  sunPct: number
  earthPct: number
}
export type Analysis = {
  day: number
  duration: number
  xs: number[]
  ys: number[]
  timeline: Timeline
}
