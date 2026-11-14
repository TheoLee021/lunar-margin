import type { SiteAssessment } from '../api/siteAssessment'
import { evaluateThresholds, type Check } from '../analysis/derive'

export interface MissionConstraints {
  minEarthPercent: number
  maxDarkHours: number
  maxSlopeDeg: number
}

export interface SiteVerdict {
  pass: boolean
  checks: Check[]
  score: number
}

/**
 * Hard constraints are evaluated before scoring: a high Sun percentage cannot
 * hide an excessive blackout or slope. Scores only rank feasible candidates.
 * All three inputs come from one NASA-data site-assessment API response.
 */
export function assessCandidate(
  data: SiteAssessment,
  constraints: MissionConstraints,
  earthWeightPercent: number,
): SiteVerdict {
  const earthChecks = evaluateThresholds(
    {
      ...data.earth,
      mean_elevation_deg: null,
    },
    { minVisibleFraction: constraints.minEarthPercent / 100 },
    { fraction: '지구 가시율', dark: '지구 차폐' },
  )
  const sunChecks = evaluateThresholds(
    {
      ...data.sun,
      mean_elevation_deg: null,
    },
    { maxDarkHours: constraints.maxDarkHours },
    { fraction: '일조율', dark: '연속 암흑' },
  )
  const slopePass = data.terrain.slope_deg <= constraints.maxSlopeDeg
  const slopeCheck: Check = {
    id: 'longest_dark',
    label: 'DEM 경사',
    pass: slopePass,
    reason: slopePass
      ? 'DEM 경사 ' + data.terrain.slope_deg.toFixed(2) + '° ≤ ' + constraints.maxSlopeDeg + '°'
      : 'DEM 경사 ' + data.terrain.slope_deg.toFixed(2) + '° > 허용 ' + constraints.maxSlopeDeg + '°',
  }
  const checks = [...earthChecks, ...sunChecks, slopeCheck]
  const weight = earthWeightPercent / 100
  return {
    pass: checks.every((check) => check.pass),
    checks,
    score: 100 * (weight * data.earth.visible_fraction +
      (1 - weight) * data.sun.visible_fraction),
  }
}
