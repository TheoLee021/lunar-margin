import type { Analysis, CandidateSite, Schedule } from './types'
import { BASE_DAY, dayOf } from './missionDates'

// Fixed chart shapes for UI evaluation only; no ephemeris, terrain or power model.
const SCORE_SHAPE = [84, 78, 89, 95, 86, 81, 92, 96, 88, 80, 90, 94, 85]
const SUN_SHAPE = [-1.5, -1.2, -0.8, -0.4, -0.7, -1, -1.3]
const EARTH_SHAPE = [-3, -4, -6, -5, -2, 1, 3]
export function demoAnalysis(
  schedule: Schedule,
  site: CandidateSite,
): Analysis {
  const day = dayOf(schedule.landing) - BASE_DAY
  const t = Array.from(
    { length: 15 },
    (_, index) => (index * schedule.duration) / 14,
  )
  const sunEl = t.map((_, index) => SUN_SHAPE[index % SUN_SHAPE.length]!)
  const earthEl = t.map((_, index) => EARTH_SHAPE[index % EARTH_SHAPE.length]!)
  return {
    day,
    duration: schedule.duration,
    xs: SCORE_SHAPE.map((_, index) => day - 60 + index * 15),
    ys: [...SCORE_SHAPE],
    timeline: {
      t,
      sunEl,
      earthEl,
      sunHz: t.map(() => -2),
      earthHz: t.map(() => -8),
      sunVis: t.map((_, index) => index % 7 !== 0),
      earthVis: t.map((_, index) => index % 9 !== 0),
      longest: site.longestDarkness,
      sunPct: site.sun / 100,
      earthPct: site.earth / 100,
    },
  }
}
