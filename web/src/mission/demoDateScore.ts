import type { DateScore, Schedule } from './types'
import { BASE_DAY, dayOf } from './missionDates'

// Fixed chart shapes for UI evaluation only; no ephemeris, terrain or power model.
const SCORE_SHAPE = [84, 78, 89, 95, 86, 81, 92, 96, 88, 80, 90, 94, 85]
export function demoDateScore(schedule: Schedule): DateScore {
  const day = dayOf(schedule.landing) - BASE_DAY
  return {
    day,
    duration: schedule.duration,
    xs: SCORE_SHAPE.map((_, index) => day - 60 + index * 15),
    ys: [...SCORE_SHAPE],
  }
}
