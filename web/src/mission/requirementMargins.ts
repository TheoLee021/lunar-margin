import type { Candidate, SearchConfig } from '../api/candidates'

export type RequirementStatus = 'PASS' | 'FAIL' | 'UNKNOWN'

export type RequirementMargin = {
  key: string
  label: string
  value: number | null
  limit: number
  margin: number | null
  unit: string
  status: RequirementStatus
  interpretation: string
}

type Direction = 'maximum' | 'minimum'

function metric(
  key: string,
  label: string,
  value: number | null | undefined,
  limit: number | null | undefined,
  unit: string,
  direction: Direction,
  interpretation: string,
): RequirementMargin | null {
  if (limit == null) return null // An unset requirement is not a failed requirement.
  const number = value == null || !Number.isFinite(value) ? null : value
  const margin =
    number === null
      ? null
      : direction === 'maximum'
        ? limit - number
        : number - limit
  return {
    key,
    label,
    value: number,
    limit,
    margin,
    unit,
    status: margin === null ? 'UNKNOWN' : margin >= 0 ? 'PASS' : 'FAIL',
    interpretation,
  }
}

/** Evaluate only thresholds saved in a completed search, never invent a lander specification. */
export function requirementMargins(
  candidate: Candidate,
  config: SearchConfig,
): RequirementMargin[] {
  const t = config.thresholds
  const commIsRf = config.rf != null
  return [
    metric(
      'sun-fraction',
      '최소 태양 기하 가시율',
      candidate.sun.fraction == null ? null : candidate.sun.fraction * 100,
      t.min_sun_fraction == null ? null : t.min_sun_fraction * 100,
      '%',
      'minimum',
      'Solar LOS does not determine generated power.',
    ),
    metric(
      'sun-dark',
      '최대 연속 암흑',
      candidate.sun.longest_dark_hours,
      t.max_sun_dark_hours,
      'h',
      'maximum',
      'Energy storage and thermal feasibility require a separate spacecraft model.',
    ),
    metric(
      'communication-fraction',
      commIsRf ? '최소 명목 RF 가능율' : '최소 지구 기하 가시율',
      commIsRf
        ? candidate.rf?.fraction == null
          ? null
          : candidate.rf.fraction * 100
        : candidate.earth.fraction == null
          ? null
          : candidate.earth.fraction * 100,
      commIsRf
        ? t.min_rf_fraction == null
          ? null
          : t.min_rf_fraction * 100
        : t.min_earth_fraction == null
          ? null
          : t.min_earth_fraction * 100,
      '%',
      'minimum',
      commIsRf
        ? 'Nominal RF excludes operational ground-station availability and weather.'
        : 'Geometric Earth LOS does not certify RF link closure.',
    ),
    metric(
      'communication-blackout',
      commIsRf ? '최대 명목 RF 두절' : '최대 지구 기하 차폐',
      commIsRf
        ? candidate.rf?.longest_blackout_hours
        : candidate.earth.longest_blackout_hours,
      commIsRf ? t.max_rf_blackout_hours : t.max_earth_blackout_hours,
      'h',
      'maximum',
      commIsRf
        ? 'Nominal RF continuity is not an end-to-end contact schedule.'
        : 'Earth occultation is based on terrain geometry only.',
    ),
    metric(
      'slope',
      '최대 지역 경사 P95',
      candidate.terrain?.slope_p95_deg,
      t.max_terrain_slope_degrees,
      '°',
      'maximum',
      '250 m regional proxy; not meter-scale touchdown safety.',
    ),
    metric(
      'roughness',
      '최대 지역 거칠기 P95',
      candidate.terrain?.roughness_p95_m,
      t.max_terrain_roughness_m,
      'm',
      'maximum',
      'DEM-scale roughness proxy; boulders are unresolved.',
    ),
  ].filter((entry): entry is RequirementMargin => entry !== null)
}

export function marginSummary(
  rows: RequirementMargin[],
): 'FAIL' | 'UNKNOWN' | 'PASS' | 'NOT_ASSESSED' {
  if (rows.length === 0) return 'NOT_ASSESSED'
  if (rows.some((row) => row.status === 'FAIL')) return 'FAIL'
  if (rows.some((row) => row.status === 'UNKNOWN')) return 'UNKNOWN'
  return 'PASS'
}
