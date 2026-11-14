import type { SiteAssessment } from '../api/siteAssessment'
import { evaluateThresholds } from '../analysis/derive'

export interface MissionConstraints {
  minEarthPercent: number
  maxDarkHours: number
  maxSlopeDeg: number
}

export interface SiteVerdict {
  pass: boolean
  checks: Array<{ id: string; label: string; pass: boolean; reason: string }>
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
  const coveragePass = data.region.coverage_fraction >= 0.9999
  const regionalSlope = data.region.slope_p95_deg
  const slopePass =
    coveragePass &&
    regionalSlope !== null &&
    regionalSlope <= constraints.maxSlopeDeg
  const slopeCheck = {
    id: 'slope',
    label: 'DEM 경사',
    pass: slopePass,
    reason: slopePass
      ? '250 m 지역 DEM 경사 P95 ' +
        regionalSlope!.toFixed(2) +
        '° ≤ ' +
        constraints.maxSlopeDeg +
        '°'
      : '250 m 지역 경사 P95 ' +
        (regionalSlope === null
          ? '확인 불가'
          : regionalSlope.toFixed(2) + '°') +
        ' · 허용 ' +
        constraints.maxSlopeDeg +
        '°',
  }
  const coverageCheck = {
    id: 'terrain_coverage',
    label: 'DEM 지역 자료 완전성',
    pass: coveragePass,
    reason: coveragePass
      ? '250 m 평가 원의 DEM 유효 표본 100%'
      : 'DEM 유효 표본 ' +
        (data.region.coverage_fraction * 100).toFixed(1) +
        '% · 결측으로 지역 지형 미검증',
  }
  const checks = [...earthChecks, ...sunChecks, slopeCheck, coverageCheck]
  const weight = earthWeightPercent / 100
  return {
    pass: checks.every((check) => check.pass),
    checks,
    score:
      100 *
      (weight * data.earth.visible_fraction +
        (1 - weight) * data.sun.visible_fraction),
  }
}
