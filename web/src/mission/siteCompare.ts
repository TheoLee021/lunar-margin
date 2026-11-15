import type { Candidate, RunDetail } from '../api/candidates'

const MOON_RADIUS_M = 1_737_400
const RAD = Math.PI / 180

/** Centre-to-centre spherical lunar arc, NOT traverse distance or terrain LOS. */
export function lunarSurfaceDistanceM(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const vals = [a.latitude, a.longitude, b.latitude, b.longitude]
  if (
    !vals.every(Number.isFinite) ||
    Math.abs(a.latitude) > 90 ||
    Math.abs(b.latitude) > 90
  )
    throw new Error('Invalid selenographic coordinates')
  const phiA = a.latitude * RAD
  const phiB = b.latitude * RAD
  const deltaPhi = phiB - phiA
  const deltaLambda = (b.longitude - a.longitude) * RAD
  const hav =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phiA) * Math.cos(phiB) * Math.sin(deltaLambda / 2) ** 2
  const angle = 2 * Math.atan2(Math.sqrt(Math.max(0, Math.min(1, hav))), Math.sqrt(Math.max(0, 1 - hav)))
  return MOON_RADIUS_M * angle
}

export interface ComparisonMetric {
  key: string
  label: string
  unit: '%' | 'h' | '°' | 'm'
  a: number | null
  b: number | null
  /** Null means this radar axis is unplottable for this candidate. */
  aScore: number | null
  bScore: number | null
  reference: string
}

const bounded = (n: number) => Math.min(100, Math.max(0, n))
const safe = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? n : null

/** Reference-based display scales, not a mission success probability or composite score. */
export function comparisonMetrics(
  a: Candidate,
  b: Candidate,
  config: RunDetail['config'],
): ComparisonMetric[] {
  const timeHours =
    (Date.parse(config.window.end) - Date.parse(config.window.start)) / 3_600_000
  if (!Number.isFinite(timeHours) || timeHours <= 0)
    throw new Error('Invalid comparison time window')
  const slopeLimit = config.thresholds.max_terrain_slope_degrees
  const roughnessLimit = config.thresholds.max_terrain_roughness_m
  const slopeReference = slopeLimit != null && slopeLimit > 0 ? slopeLimit : 15
  const roughnessReference = roughnessLimit != null && roughnessLimit > 0 ? roughnessLimit : 20

  function metric(
    key: string,
    label: string,
    unit: ComparisonMetric['unit'],
    av: number | null | undefined,
    bv: number | null | undefined,
    reference: number,
    higherIsBetter: boolean,
    referenceText: string,
  ): ComparisonMetric {
    const aValue = safe(av)
    const bValue = safe(bv)
    const score = (n: number | null) =>
      n === null ? null : bounded(100 * (higherIsBetter ? n / reference : 1 - n / reference))
    return {
      key,
      label,
      unit,
      a: aValue,
      b: bValue,
      aScore: score(aValue),
      bScore: score(bValue),
      reference: referenceText,
    }
  }
  return [
    metric('sun', '일조율', '%', a.sun.fraction == null ? null : 100 * a.sun.fraction, b.sun.fraction == null ? null : 100 * b.sun.fraction, 100, true, '100%'),
    metric('dark', '연속 암흑', 'h', a.sun.longest_dark_hours, b.sun.longest_dark_hours, timeHours, false, `전체 분석 기간 ${timeHours.toFixed(0)}h`),
    metric('earth', '지구 LOS', '%', a.earth.fraction == null ? null : 100 * a.earth.fraction, b.earth.fraction == null ? null : 100 * b.earth.fraction, 100, true, '100%'),
    metric('blackout', '연속 지구 차폐', 'h', a.earth.longest_blackout_hours, b.earth.longest_blackout_hours, timeHours, false, `전체 분석 기간 ${timeHours.toFixed(0)}h`),
    metric('slope', '지역 경사 P95', '°', a.terrain?.slope_p95_deg, b.terrain?.slope_p95_deg, slopeReference, false, slopeLimit != null && slopeLimit > 0 ? `임무 한도 ${slopeReference}°` : '시각화 기준 15°'),
    metric('roughness', '지역 거칠기 P95', 'm', a.terrain?.roughness_p95_m, b.terrain?.roughness_p95_m, roughnessReference, false, roughnessLimit != null && roughnessLimit > 0 ? `임무 한도 ${roughnessReference}m` : '시각화 기준 20m'),
  ]
}

export function formatComparisonDistance(meters: number): string {
  return meters < 1000 ? `${meters.toFixed(1)} m` : `${(meters / 1000).toFixed(3)} km`
}

export function nextComparisonIds(
  current: readonly string[],
  clicked: string,
  selected: string | null,
): string[] {
  if (current.includes(clicked)) return current.filter((id) => id !== clicked)
  if (current.length === 0 && selected && selected !== clicked)
    return [selected, clicked]
  if (current.length === 0) return [clicked]
  if (current.length === 1) return [...current, clicked]
  return [current[1]!, clicked]
}
