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
