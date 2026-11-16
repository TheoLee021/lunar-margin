import {
  fetchAnalysis,
  type Analysis,
  type AnalysisParams,
} from '../api/analysis'
import type { RequestOptions } from '../api/client'
import { horizonAtAzimuth } from '../analysis/derive'
import { DAY } from './missionDates'
import type { CandidateSite, Schedule, Timeline } from './types'

export type LiveMissionAnalysis = {
  sun: Analysis
  earth: Analysis
  timeline: Timeline
}

/** Minutes between the samples of a mission: the timeline and the Sun that follows it share them. */
export const MISSION_STEP_MINUTES = 30

/** The landing time: midnight UTC of the landing date. */
export function landingStart(landing: string): string {
  return `${landing}T00:00:00Z`
}

/** The end of the surface mission: `duration` days after the landing time. */
export function missionEnd(landing: string, duration: number): string {
  return new Date(Date.parse(landingStart(landing)) + duration * DAY)
    .toISOString()
    .replace('.000Z', 'Z')
}

/** Surface analysis starts at landing midnight UTC, not Earth departure. */
export function missionParams(
  site: CandidateSite,
  schedule: Schedule,
): AnalysisParams {
  return {
    lat: site.latitude,
    lon: site.longitude,
    start: landingStart(schedule.landing),
    end: missionEnd(schedule.landing, schedule.duration),
    step_minutes: MISSION_STEP_MINUTES,
    observer_height_m: 0,
  }
}

export async function loadMissionAnalysis(
  params: AnalysisParams,
  signal?: AbortSignal,
  options?: Omit<RequestOptions, 'signal'>,
): Promise<LiveMissionAnalysis> {
  const [sun, earth] = await Promise.all([
    fetchAnalysis('illumination', params, signal, options),
    fetchAnalysis('earth-visibility', params, signal, options),
  ])
  const start = Date.parse(params.start)
  const end = Date.parse(params.end)
  for (const body of [sun, earth]) {
    const az = body.horizon.azimuth_deg
    const times = body.series.times.map(Date.parse)
    if (
      body.lat !== params.lat ||
      body.lon !== params.lon ||
      Date.parse(body.start) !== start ||
      Date.parse(body.end) !== end ||
      body.step_minutes !== params.step_minutes ||
      body.observer_height_m !== params.observer_height_m ||
      az.length === 0 ||
      az[0] !== 0 ||
      az.some((v, i) => v >= 360 || (i > 0 && v <= az[i - 1]!)) ||
      times.some(
        (v, i) => v < start || v >= end || (i > 0 && v <= times[i - 1]!),
      )
    )
      throw new Error(
        'The analysis response does not match the requested site, period or horizon.',
      )
  }
  if (
    sun.series.times.length !== earth.series.times.length ||
    sun.series.times.some(
      (time, index) =>
        Date.parse(time) !== Date.parse(earth.series.times[index]!),
    )
  )
    throw new Error('The analysis response time axes do not match.')
  const day = (iso: string) => (Date.parse(iso) - start) / DAY
  const periods = (body: Analysis) =>
    [
      ...body.windows.map((p) => ({
        start: day(p.start),
        end: day(p.end),
        on: true,
      })),
      ...body.dark_periods.map((p) => ({
        start: day(p.start),
        end: day(p.end),
        on: false,
      })),
    ]
      .map((p) => ({
        ...p,
        start: Math.max(0, p.start),
        end: Math.min((end - start) / DAY, p.end),
      }))
      .filter((p) => p.end > p.start)
      .toSorted((a, b) => a.start - b.start)
  return {
    sun,
    earth,
    timeline: {
      t: sun.series.times.map(day),
      sunEl: sun.series.body_elevation_deg,
      earthEl: earth.series.body_elevation_deg,
      sunHz: sun.series.body_azimuth_deg.map((az) =>
        horizonAtAzimuth(sun.horizon, az),
      ),
      earthHz: earth.series.body_azimuth_deg.map((az) =>
        horizonAtAzimuth(earth.horizon, az),
      ),
      sunVis: sun.series.visible,
      earthVis: earth.series.visible,
      sunPeriods: periods(sun),
      earthPeriods: periods(earth),
      start: params.start,
      end: params.end,
      stepMinutes: params.step_minutes,
    },
  }
}
