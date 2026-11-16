import type { Candidate, SearchConfig } from '../api/candidates'

/** 저장된 탐색 조건 하나와, 후보의 값이 그 한도에서 얼마나 떨어져 있는지. */
export interface RequirementMargin {
  key: string
  label: string
  /** 'min'은 값이 한도 이상, 'max'는 한도 이하여야 하는 조건이다. */
  bound: 'min' | 'max'
  unit: '%' | '시간' | '°' | 'm'
  value: number | null
  limit: number
  /** 한도 안쪽으로 남은 여유. 음수면 한도를 벗어난 것이고, 값이 없으면 null이다. */
  margin: number | null
}

type Site = Pick<Candidate, 'sun' | 'earth' | 'rf' | 'terrain'>
type Config = Pick<SearchConfig, 'thresholds' | 'rf'>
type Maybe = number | null | undefined

function row(
  key: string,
  label: string,
  bound: RequirementMargin['bound'],
  unit: RequirementMargin['unit'],
  value: Maybe,
  limit: Maybe,
): RequirementMargin | null {
  if (limit == null) return null // 한도가 없는 조건은 표에 넣지 않는다
  const margin =
    value == null ? null : bound === 'max' ? limit - value : value - limit
  return { key, label, bound, unit, value: value ?? null, limit, margin }
}

const percent = (fraction: Maybe) => (fraction == null ? null : fraction * 100)

/**
 * 탐색에 저장된 한도와 후보의 저장된 지표만으로 여유를 계산한다.
 * 적격 여부는 판정하지 않는다. 판정은 백엔드의 eligibility가 맡는다.
 * RF 탐색이면 통신 조건을 지구 LOS가 아니라 명목 RF 값으로 본다.
 */
export function requirementMargins(
  site: Site,
  config: Config,
): RequirementMargin[] {
  const t = config.thresholds
  const rf = config.rf != null
  return [
    row(
      'sun-fraction',
      '일조율',
      'min',
      '%',
      percent(site.sun.fraction),
      percent(t.min_sun_fraction),
    ),
    row(
      'sun-dark',
      '최장 연속 어둠',
      'max',
      '시간',
      site.sun.longest_dark_hours,
      t.max_sun_dark_hours,
    ),
    rf
      ? row(
          'communication-fraction',
          'RF 통신 가능 비율',
          'min',
          '%',
          percent(site.rf?.fraction),
          percent(t.min_rf_fraction),
        )
      : row(
          'communication-fraction',
          '지구 가시율',
          'min',
          '%',
          percent(site.earth.fraction),
          percent(t.min_earth_fraction),
        ),
    rf
      ? row(
          'communication-blackout',
          'RF 최장 두절',
          'max',
          '시간',
          site.rf?.longest_blackout_hours,
          t.max_rf_blackout_hours,
        )
      : row(
          'communication-blackout',
          '최장 지구 차폐',
          'max',
          '시간',
          site.earth.longest_blackout_hours,
          t.max_earth_blackout_hours,
        ),
    row(
      'slope',
      '지역 경사 P95',
      'max',
      '°',
      site.terrain?.slope_p95_deg,
      t.max_terrain_slope_degrees,
    ),
    row(
      'roughness',
      '지역 거칠기 P95',
      'max',
      'm',
      site.terrain?.roughness_p95_m,
      t.max_terrain_roughness_m,
    ),
  ].filter((entry) => entry !== null)
}
