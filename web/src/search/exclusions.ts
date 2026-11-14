import type { SearchThresholds } from '../api/candidates'
import { fractionText, reasonLabel } from './derive'

// "왜 후보가 안 나왔나"를 설명하기 위한, 필수 조건에 의한 제외 사유 집계.
// not_refined, within_min_separation, beyond_top_k 는 조건이 아니라 계산·선정 방식 때문이라 뺀다.

const FILTER_REASON_KEYS = [
  'sun_fraction_below_min',
  'sun_dark_hours_above_max',
  'earth_fraction_below_min',
  'earth_blackout_hours_above_max',
  'horizon_incomplete',
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
