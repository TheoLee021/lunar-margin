import type { Candidate } from '../api/candidates'

export const COMPARISON_COLORS = [
  '#67e8f9',
  '#fbbf24',
  '#c4b5fd',
  '#fb7185',
  '#86efac',
] as const

export interface ComparisonAxis {
  key: string
  label: string
  unit: '%' | '시간' | '°' | 'm'
  higherIsBetter: boolean
  reference: number
  referenceLabel: string
}

type Config = {
  window: { start: string; end: string }
  thresholds: {
    max_terrain_slope_degrees?: number | null
    max_terrain_roughness_m?: number | null
  }
}

/** Scales belong to the saved mission, never the currently checked candidates. */
export function comparisonAxes(config: Config): ComparisonAxis[] {
  const hours =
    (Date.parse(config.window.end) - Date.parse(config.window.start)) /
    3_600_000
  if (!Number.isFinite(hours) || hours <= 0)
    throw new Error('비교 기간이 유효하지 않습니다.')
  const slope = config.thresholds.max_terrain_slope_degrees
  const roughness = config.thresholds.max_terrain_roughness_m
  const axis = (
    key: string,
    label: string,
    unit: ComparisonAxis['unit'],
    higherIsBetter: boolean,
    reference: number,
    referenceLabel: string,
  ): ComparisonAxis => ({
    key,
    label,
    unit,
    higherIsBetter,
    reference,
    referenceLabel,
  })
  return [
    axis('sun', '일조율', '%', true, 100, '0–100%'),
    axis(
      'dark',
      '최장 연속 어둠',
      '시간',
      false,
      hours,
      `0–${hours}시간 · 전체 임무 기간`,
    ),
    axis('earth', '지구 가시율', '%', true, 100, '0–100% · 지구 중심 LOS'),
    axis(
      'blackout',
      '최장 지구 차폐',
      '시간',
      false,
      hours,
      `0–${hours}시간 · 전체 임무 기간`,
    ),
    axis(
      'slope',
      '지역 경사 P95',
      '°',
      false,
      slope != null && slope > 0 ? slope : 15,
      slope != null && slope > 0
        ? `0–${slope}° · 임무 한도`
        : '0–15° · 표시 기준, 안전 한도 아님',
    ),
    axis(
      'roughness',
      '지역 거칠기 P95',
      'm',
      false,
      roughness != null && roughness > 0 ? roughness : 20,
      roughness != null && roughness > 0
        ? `0–${roughness}m · 임무 한도`
        : '0–20m · 표시 기준, 안전 한도 아님',
    ),
  ]
}

type Site = {
  sun: Pick<Candidate['sun'], 'fraction' | 'longest_dark_hours'>
  earth: Pick<Candidate['earth'], 'fraction' | 'longest_blackout_hours'>
  terrain?: Pick<
    NonNullable<Candidate['terrain']>,
    'coverage_fraction' | 'slope_p95_deg' | 'roughness_p95_m'
  > | null
}

/** Incomplete terrain remains unknown, and is never drawn as an ideal zero. */
export function comparisonValues(site: Site, axes: readonly ComparisonAxis[]) {
  const terrain =
    (site.terrain?.coverage_fraction ?? 0) >= 0.9999 ? site.terrain : null
  const percent = (value: number | null) =>
    value === null ? null : value * 100
  const raw = [
    percent(site.sun.fraction),
    site.sun.longest_dark_hours,
    percent(site.earth.fraction),
    site.earth.longest_blackout_hours,
    terrain?.slope_p95_deg,
    terrain?.roughness_p95_m,
  ]
  return axes.map((axis, index) => {
    const rawValue = raw[index]
    const value =
      rawValue != null && Number.isFinite(rawValue) ? rawValue : null
    return {
      value,
      radius:
        value === null
          ? null
          : Math.min(
              1,
              Math.max(
                0,
                axis.higherIsBetter
                  ? value / axis.reference
                  : 1 - value / axis.reference,
              ),
            ),
    }
  })
}

export function toggleComparison(
  current: readonly string[],
  id: string,
  allowed: readonly string[],
): string[] {
  const top = allowed.slice(0, 5)
  const valid = [...new Set(current)].filter((value) => top.includes(value))
  if (valid.includes(id)) return valid.filter((value) => value !== id)
  return top.includes(id) && valid.length < 5 ? [...valid, id] : valid
}
