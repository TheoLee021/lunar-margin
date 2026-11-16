import type { Candidate, SearchConfig } from '../api/candidates'

/** 저장된 탐색 조건 하나와, 후보의 값이 그 한도에서 얼마나 떨어져 있는지. */
export interface RequirementMargin {
  key: string
  label: string
  /** 'min'은 값이 한도 이상, 'max'는 한도 이하여야 하는 조건이다. */
  bound: 'min' | 'max'
  unit: '%' | 'h' | '°' | 'm'
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
      'Sunlight',
      'min',
      '%',
      percent(site.sun.fraction),
      percent(t.min_sun_fraction),
    ),
    row(
      'sun-dark',
      'Longest darkness',
      'max',
      'h',
      site.sun.longest_dark_hours,
      t.max_sun_dark_hours,
    ),
    rf
      ? row(
          'communication-fraction',
          'RF availability',
          'min',
          '%',
          percent(site.rf?.fraction),
          percent(t.min_rf_fraction),
        )
      : row(
          'communication-fraction',
          'Earth visibility',
          'min',
          '%',
          percent(site.earth.fraction),
          percent(t.min_earth_fraction),
        ),
    rf
      ? row(
          'communication-blackout',
          'Longest RF outage',
          'max',
          'h',
          site.rf?.longest_blackout_hours,
          t.max_rf_blackout_hours,
        )
      : row(
          'communication-blackout',
          'Longest Earth blackout',
          'max',
          'h',
          site.earth.longest_blackout_hours,
          t.max_earth_blackout_hours,
        ),
    row(
      'slope',
      'Local slope P95',
      'max',
      '°',
      site.terrain?.slope_p95_deg,
      t.max_terrain_slope_degrees,
    ),
    row(
      'roughness',
      'Local roughness P95',
      'max',
      'm',
      site.terrain?.roughness_p95_m,
      t.max_terrain_roughness_m,
    ),
  ].filter((entry) => entry !== null)
}

const DIGITS: Record<RequirementMargin['unit'], number> = {
  '%': 1,
  h: 1,
  '°': 1,
  m: 2,
}
const SUFFIX: Record<RequirementMargin['unit'], string> = {
  '%': '%',
  h: ' h',
  '°': '°',
  m: ' m',
}

/** 값을 단위에 맞는 자릿수와 표기로 쓴다. */
export function formatAmount(
  value: number,
  unit: RequirementMargin['unit'],
): string {
  return `${value.toFixed(DIGITS[unit])}${SUFFIX[unit]}`
}

/** 값끼리의 차이를 쓴다. 비율끼리의 차이는 퍼센트가 아니라 퍼센트포인트다. */
function formatDifference(
  value: number,
  unit: RequirementMargin['unit'],
): string {
  return `${value.toFixed(DIGITS[unit])}${unit === '%' ? ' pp' : SUFFIX[unit]}`
}

/** 여유를 부호와 함께 쓴다. 양수면 한도 안쪽이다. */
export function formatMargin(
  margin: number,
  unit: RequirementMargin['unit'],
): string {
  const text = formatDifference(margin, unit)
  return margin < 0 ? text : `+${text}`
}

/** 한도를 벗어난 조건마다 값과 한도, 벗어난 양을 한 문장으로 낸다. */
export function limitAlerts(rows: readonly RequirementMargin[]): string[] {
  return rows.flatMap((row) =>
    row.value === null || row.margin === null || row.margin >= 0
      ? []
      : [
          `${row.label} ${formatAmount(row.value, row.unit)} · limit ${
            row.bound === 'max' ? '≤' : '≥'
          } ${formatAmount(row.limit, row.unit)} · ${
            row.bound === 'max' ? 'over' : 'short'
          } by ${formatDifference(-row.margin, row.unit)}`,
        ],
  )
}
