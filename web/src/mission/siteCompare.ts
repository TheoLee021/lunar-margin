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
  unit: '%' | 'h' | '°' | 'm' | 'dB'
  higherIsBetter: boolean
  reference: number
  minimum?: number
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
    throw new Error('The comparison period is invalid.')
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
    axis('sun', 'Sunlight', '%', true, 100, '0–100%'),
    axis(
      'dark',
      'Longest darkness',
      'h',
      false,
      hours,
      `0–${hours} h · full mission`,
    ),
    {
      ...axis(
        'rf',
        'RF link margin',
        'dB',
        true,
        30,
        '−30 to +30 dB · display range',
      ),
      minimum: -30,
    },
    axis(
      'blackout',
      'Longest Earth blackout',
      'h',
      false,
      hours,
      `0–${hours} h · full mission`,
    ),
    axis(
      'slope',
      'Local slope P95',
      '°',
      false,
      slope != null && slope > 0 ? slope : 15,
      slope != null && slope > 0
        ? `0–${slope}° · mission limit`
        : '0–15° · display scale, not a safety limit',
    ),
    axis(
      'roughness',
      'Local roughness P95',
      'm',
      false,
      roughness != null && roughness > 0 ? roughness : 20,
      roughness != null && roughness > 0
        ? `0–${roughness} m · mission limit`
        : '0–20 m · display scale, not a safety limit',
    ),
  ]
}

type Site = {
  sun: Pick<Candidate['sun'], 'fraction' | 'longest_dark_hours'>
  rf?: Pick<NonNullable<Candidate['rf']>, 'min_link_margin_db'> | null
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
    site.rf?.min_link_margin_db,
    site.earth.longest_blackout_hours,
    terrain?.slope_p95_deg,
    terrain?.roughness_p95_m,
  ]
  return axes.map((axis, index) => {
    const rawValue = raw[index]
    const value =
      rawValue != null && Number.isFinite(rawValue) ? rawValue : null
    const minimum = axis.minimum ?? 0
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
                  ? (value - minimum) / (axis.reference - minimum)
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

/**
 * Which of the values compared in one row are the best. Ties are all marked, a missing
 * value never is, and nothing is marked unless at least two values can be compared.
 */
export function bestValues(
  values: readonly (number | null)[],
  higherIsBetter: boolean,
): boolean[] {
  const known = values.filter((value) => value !== null)
  if (known.length < 2) return values.map(() => false)
  const best = higherIsBetter ? Math.max(...known) : Math.min(...known)
  return values.map((value) => value === best)
}
