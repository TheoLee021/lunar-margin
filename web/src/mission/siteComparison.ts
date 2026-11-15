import type { Candidate, RunDetail } from '../api/candidates'

const MOON_RADIUS_M = 1_737_400
const COMPLETE_COVERAGE = 0.9999

export type ComparisonId = string
export type MetricId =
  | 'sun'
  | 'sun_dark'
  | 'earth'
  | 'earth_blackout'
  | 'slope'
  | 'roughness'

export type ComparisonMetric = {
  id: MetricId
  label: string
  unit: '%' | 'h' | '°' | 'm'
  a: number | null
  b: number | null
  aRadar: number | null
  bRadar: number | null
  limit: number | null
  limitKind: 'min' | 'max'
}

/** The 500 m candidate-center separation, not traversable path length or LOS. */
export function lunarSurfaceDistanceM(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  if (![latitudeA, longitudeA, latitudeB, longitudeB].every(Number.isFinite))
    throw new Error('Lunar coordinates must be finite')
  if (Math.abs(latitudeA) > 90 || Math.abs(latitudeB) > 90)
    throw new Error('Lunar latitude must be within ±90 degrees')
  const radians = Math.PI / 180
  const latA = latitudeA * radians
  const latB = latitudeB * radians
  const dLat = (latitudeB - latitudeA) * radians
  const dLon = (longitudeB - longitudeA) * radians
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2
  const a = Math.max(0, Math.min(1, haversine))
  return 2 * MOON_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Preserve the existing single-site selection; modified click only alters A/B. */
export function selectComparisonSite(
  current: readonly ComparisonId[],
  siteId: ComparisonId,
  primarySiteId: ComparisonId | null,
): ComparisonId[] {
  if (current.length === 0) {
    return primarySiteId && primarySiteId !== siteId
      ? [primarySiteId, siteId]
      : [siteId]
  }
  if (current.length === 1) {
    return current[0] === siteId ? [siteId] : [current[0]!, siteId]
  }
  if (current.includes(siteId)) return [...current]
  return [current[0]!, siteId]
}

export function comparableWindowHours(config: RunDetail['config']): number {
  const hours =
    (Date.parse(config.window.end) - Date.parse(config.window.start)) / 3_600_000
  if (!Number.isFinite(hours) || hours <= 0)
    throw new Error('Candidate comparison requires a valid common UTC window')
  return hours
}

function actual(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : value
}

function normalized(
  value: number | null,
  max: number,
  reverse = false,
): number | null {
  if (value === null) return null
  const fraction = Math.max(0, Math.min(1, value / max))
  return (reverse ? 1 - fraction : fraction) * 100
}

/**
 * Display normalization only. Fractions use 0–100%; darkness/outage use the
 * shared mission duration; terrain uses fixed 0–20° and 0–30 m chart ranges.
 * These reference spans are NOT requirements, scores or success probabilities.
 */
export function comparisonMetrics(
  a: Candidate,
  b: Candidate,
  config: RunDetail['config'],
): ComparisonMetric[] {
  const windowHours = comparableWindowHours(config)
  const limits = config.thresholds
  const specs: {
    id: MetricId
    label: string
    unit: ComparisonMetric['unit']
    get: (candidate: Candidate) => number | null
    max: number
    reverse: boolean
    limit: number | null
    limitKind: ComparisonMetric['limitKind']
  }[] = [
    {
      id: 'sun',
      label: '일조율',
      unit: '%',
      get: (site) => {
        const value = actual(site.sun.fraction)
        return value === null ? null : value * 100
      },
      max: 100,
      reverse: false,
      limit: limits.min_sun_fraction === null ? null : limits.min_sun_fraction * 100,
      limitKind: 'min',
    },
    {
      id: 'sun_dark',
      label: '최장 연속 암흑',
      unit: 'h',
      get: (site) => actual(site.sun.longest_dark_hours),
      max: windowHours,
      reverse: true,
      limit: limits.max_sun_dark_hours,
      limitKind: 'max',
    },
    {
      id: 'earth',
      label: '지구 LOS 가시율',
      unit: '%',
      get: (site) => {
        const value = actual(site.earth.fraction)
        return value === null ? null : value * 100
      },
      max: 100,
      reverse: false,
      limit: limits.min_earth_fraction === null ? null : limits.min_earth_fraction * 100,
      limitKind: 'min',
    },
    {
      id: 'earth_blackout',
      label: '최장 지구 차폐',
      unit: 'h',
      get: (site) => actual(site.earth.longest_blackout_hours),
      max: windowHours,
      reverse: true,
      limit: limits.max_earth_blackout_hours,
      limitKind: 'max',
    },
    {
      id: 'slope',
      label: '지역 경사 P95',
      unit: '°',
      get: (site) =>
        site.terrain?.coverage_fraction != null &&
        site.terrain.coverage_fraction >= COMPLETE_COVERAGE
          ? actual(site.terrain.slope_p95_deg)
          : null,
      max: 20,
      reverse: true,
      limit: limits.max_terrain_slope_degrees ?? null,
      limitKind: 'max',
    },
    {
      id: 'roughness',
      label: '지역 거칠기 P95',
      unit: 'm',
      get: (site) =>
        site.terrain?.coverage_fraction != null &&
        site.terrain.coverage_fraction >= COMPLETE_COVERAGE
          ? actual(site.terrain.roughness_p95_m)
          : null,
      max: 30,
      reverse: true,
      limit: limits.max_terrain_roughness_m ?? null,
      limitKind: 'max',
    },
  ]
  return specs.map(({ id, label, unit, get, max, reverse, limit, limitKind }) => {
    const valueA = get(a)
    const valueB = get(b)
    return {
      id,
      label,
      unit,
      a: valueA,
      b: valueB,
      aRadar: normalized(valueA, max, reverse),
      bRadar: normalized(valueB, max, reverse),
      limit,
      limitKind,
    }
  })
}

export function metricPass(
  value: number | null,
  limit: number | null,
  kind: ComparisonMetric['limitKind'],
): boolean | null {
  if (value === null || limit === null) return null
  return kind === 'min' ? value >= limit : value <= limit
}
