import type { CandidateSite, MissionSelection } from './types'

// Example coordinates for the mission HUD, not landing recommendations.
// Their metrics come from GET /analysis/site-assessment.
export const DEMO_SITES: readonly CandidateSite[] = [
  {
    id: 'site-1',
    name: '후보 1',
    latitude: -89.83,
    longitude: -153.7,
  },
  {
    id: 'site-2',
    name: '후보 2',
    latitude: -89.02,
    longitude: -94.4,
  },
  {
    id: 'site-3',
    name: '후보 3',
    latitude: -85.44,
    longitude: -115,
  },
  {
    id: 'site-4',
    name: '후보 4',
    latitude: -87.99,
    longitude: -166.5,
  },
  {
    id: 'site-5',
    name: '후보 5',
    latitude: -88.47,
    longitude: -67.7,
  },
]
export const INITIAL_SELECTION: MissionSelection = {
  departure: '2027-01-06',
  landing: '2027-01-10',
  duration: 14,
  siteId: 'site-1',
}
