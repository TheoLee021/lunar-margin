import type { SearchThresholds } from '../api/candidates'
import { fractionText, reasonLabel } from './derive'

// "왜 후보가 안 나왔나"를 설명하기 위한, 필수 조건에 의한 제외 사유 집계.
// not_refined, within_min_separation, beyond_top_k 는 조건이 아니라 계산·선정 방식 때문이라 뺀다.

const FILTER_REASON_KEYS = [
  'rf_incomplete',
  'rf_fraction_below_min',
  'rf_blackout_hours_above_max',
  'sun_fraction_below_min',
  'sun_dark_hours_above_max',
  'earth_fraction_below_min',
  'earth_blackout_hours_above_max',
  'horizon_incomplete',
  'terrain_slope_above_max',
  'terrain_roughness_above_max',
  'terrain_incomplete',
  'no_metrics',
] as const

export interface ExclusionRow {
  key: string
  count: number
  label: string
}

/** 점이 하나 이상 걸린 조건만, 많은 순서로. */
export function filterExclusions(
  reasons: Readonly<Record<string, number>>,
): ExclusionRow[] {
  return FILTER_REASON_KEYS.map((key) => ({
    key,
    count: reasons[key] ?? 0,
    label: reasonLabel(key),
  }))
    .filter((row) => row.count > 0)
    .toSorted((a, b) => b.count - a.count)
}

export interface DominantExclusion extends ExclusionRow {
  /** 사용자가 정한 한도 문장 (예: "최장 통신 두절 6시간 이하"). 모르면 null. */
  limit: string | null
  advice: string
}

export function dominantExclusion(
  reasons: Readonly<Record<string, number>>,
  thresholds: SearchThresholds,
): DominantExclusion | null {
  const top = filterExclusions(reasons)[0]
  if (top === undefined) return null

  switch (top.key) {
    case 'rf_fraction_below_min':
      return {
        ...top,
        limit:
          thresholds.min_rf_fraction == null
            ? null
            : `RF 통신 가능 비율 ${fractionText(thresholds.min_rf_fraction)} 이상`,
        advice: '최소 RF 비율을 낮추거나 RF 링크 조건을 확인하세요.',
      }
    case 'rf_blackout_hours_above_max':
      return {
        ...top,
        limit:
          thresholds.max_rf_blackout_hours == null
            ? null
            : `RF 최장 두절 ${thresholds.max_rf_blackout_hours}시간 이하`,
        advice:
          'RF 두절 한도와 링크 조건을 확인하세요. LOS 차폐는 RF 전력 증가로 해결되지 않습니다.',
      }

    case 'sun_dark_hours_above_max': {
      const hours = thresholds.max_sun_dark_hours
      return {
        ...top,
        limit: hours === null ? null : `최장 연속 암흑 ${hours}시간 이하`,
        advice:
          hours === null
            ? '연속 암흑 한도를 늘려 보세요.'
            : `최대 연속 암흑 한도(${hours}시간)를 늘려 보세요.`,
      }
    }
    case 'earth_blackout_hours_above_max': {
      const hours = thresholds.max_earth_blackout_hours
      return {
        ...top,
        limit: hours === null ? null : `최장 통신 두절 ${hours}시간 이하`,
        advice:
          hours === null
            ? '통신 두절 한도를 늘려 보세요.'
            : `최대 통신 두절 한도(${hours}시간)를 늘려 보세요.`,
      }
    }
    case 'sun_fraction_below_min': {
      const min = thresholds.min_sun_fraction
      return {
        ...top,
        limit: min === null ? null : `일조율 ${fractionText(min)} 이상`,
        advice: '최소 일조율 기준을 낮춰 보세요.',
      }
    }
    case 'earth_fraction_below_min': {
      const min = thresholds.min_earth_fraction
      return {
        ...top,
        limit: min === null ? null : `지구 가시율 ${fractionText(min)} 이상`,
        advice: '최소 지구 가시율 기준을 낮춰 보세요.',
      }
    }
    case 'terrain_slope_above_max': {
      const degrees = thresholds.max_terrain_slope_degrees
      return {
        ...top,
        limit: degrees == null ? null : `250 m 지역 경사 P95 ${degrees}° 이하`,
        advice: '지형 경사 한도를 늘리거나 다른 지역을 살펴보세요.',
      }
    }
    case 'terrain_roughness_above_max':
      return {
        ...top,
        limit:
          thresholds.max_terrain_roughness_m == null
            ? null
            : `지역 거칠기 P95 ${thresholds.max_terrain_roughness_m} m 이하`,
        advice: '거칠기 한도를 늘리거나 다른 지역을 살펴보세요.',
      }
    case 'terrain_incomplete':
      return {
        ...top,
        limit: '250 m 평가 원의 DEM 유효 표본 100%',
        advice:
          '지역 지형 자료가 완전한 지점을 살펴보세요. 결측은 완만한 지형을 뜻하지 않습니다.',
      }
    case 'horizon_incomplete':
      return {
        ...top,
        limit: null,
        advice:
          '수평선이 높이 지도 밖으로 나가는 점을 제외하도록 설정되어 있습니다.',
      }
    default:
      return {
        ...top,
        limit: null,
        advice: '탐색 구역이 높이 지도 안에 있는지 확인하세요.',
      }
  }
}
