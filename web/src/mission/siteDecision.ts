import type { SiteAssessment } from '../api/analysis'
import { evaluateThresholds, type Check } from '../analysis/derive'

/** HUD 슬라이더의 필수 조건. 점수와 별개로, 하나라도 어기면 FAIL이다. */
export interface MissionConstraints {
  minEarthPercent: number
  maxDarkHours: number
  maxSlopeDeg: number
}

// 후보 탐색 필터(api filtering.py)와 같은 기준. 결측은 완만한 지형이 아니다.
const COMPLETE_COVERAGE = 0.9999

export interface SiteCheck {
  id: Check['id'] | 'slope' | 'terrain_coverage'
  label: string
  pass: boolean
  reason: string
}

export interface SiteVerdict {
  pass: boolean
  checks: SiteCheck[]
  /** 0~100. 통신 가중치로 섞은 지구·태양 가시율. 순위용이며 성공 확률이 아니다. */
  score: number
}

export function judgeSite(
  site: SiteAssessment,
  limits: MissionConstraints,
  earthWeightPercent: number,
): SiteVerdict {
  const checks: SiteCheck[] = [
    ...evaluateThresholds(
      site.earth,
      { minVisibleFraction: limits.minEarthPercent / 100 },
      { fraction: '지구 가시율', dark: '최장 지구 차폐' },
    ),
    ...evaluateThresholds(
      site.sun,
      { maxDarkHours: limits.maxDarkHours },
      { fraction: '일조율', dark: '최장 연속 어둠' },
    ),
    slopeCheck(site.terrain, limits.maxSlopeDeg),
    coverageCheck(site.terrain),
  ]
  const weight = earthWeightPercent / 100
  return {
    pass: checks.every((check) => check.pass),
    checks,
    score:
      100 *
      (weight * site.earth.visible_fraction +
        (1 - weight) * site.sun.visible_fraction),
  }
}

function slopeCheck(
  terrain: SiteAssessment['terrain'],
  maxDeg: number,
): SiteCheck {
  const area = `${terrain.assessment_radius_m} m 지역 경사 P95`
  const slope = terrain.slope_p95_deg
  const pass = slope !== null && slope <= maxDeg
  return {
    id: 'slope',
    label: `${area} ≤ ${maxDeg}°`,
    pass,
    reason:
      slope === null
        ? `${area}를 계산하지 못했습니다.`
        : pass
          ? `${area} ${slope.toFixed(1)}°로 허용 ${maxDeg}° 이내입니다.`
          : `${area} ${slope.toFixed(1)}°로 허용 ${maxDeg}°를 넘습니다.`,
  }
}

function coverageCheck(terrain: SiteAssessment['terrain']): SiteCheck {
  const coverage = terrain.coverage_fraction
  const pass = coverage !== null && coverage >= COMPLETE_COVERAGE
  return {
    id: 'terrain_coverage',
    label: 'DEM 유효 표본 100%',
    pass,
    reason:
      coverage === null
        ? 'DEM 유효 표본을 확인할 수 없어 지형을 판정하지 못했습니다.'
        : pass
          ? 'DEM 유효 표본 100%입니다.'
          : `DEM 유효 표본 ${(coverage * 100).toFixed(1)}%라 지형을 판정할 수 없습니다.`,
  }
}
