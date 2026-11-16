import { z } from 'zod'
import type { MissionRequest } from '../api/candidates'

/**
 * 검색 화면에서 정한 필수 조건. null은 "조건 없음"이며 0과 다르다.
 * 지역 경사 한도는 일정과 함께 다니던 값이라 `MissionSelection.maxSlope`에 그대로 둔다.
 */
export type Requirements = {
  minSunPercent: number | null
  minCommPercent: number | null
  maxDarknessHours: number | null
  maxBlackoutHours: number | null
  maxRoughnessM: number | null
}

/** 검색 화면을 거치지 않았을 때 쓰는 한도. 날짜 계획이 원래 쓰던 값과 같다. */
export const DEFAULT_REQUIREMENTS: Requirements = {
  minSunPercent: null,
  minCommPercent: null,
  maxDarknessHours: 24,
  maxBlackoutHours: 6,
  maxRoughnessM: null,
}

const Percent = z.number().min(0).max(100).nullable()
const NonNegative = z.number().nonnegative().nullable()
const RequirementsSchema = z.object({
  minSunPercent: Percent,
  minCommPercent: Percent,
  maxDarknessHours: NonNegative,
  maxBlackoutHours: NonNegative,
  maxRoughnessM: NonNegative,
})

// max_slope와 같은 규칙: 숫자, 또는 조건 없음을 뜻하는 'none'.
const PARAMS = {
  minSunPercent: 'min_sun',
  minCommPercent: 'min_comm',
  maxDarknessHours: 'max_dark',
  maxBlackoutHours: 'max_blackout',
  maxRoughnessM: 'max_roughness',
} as const satisfies Record<keyof Requirements, string>
const KEYS = Object.keys(PARAMS) as (keyof Requirements)[]

/** URL에 조건이 하나도 없거나 하나라도 잘못됐으면 undefined (검색 화면을 거치지 않은 주소). */
export function readRequirements(
  params: URLSearchParams,
): Requirements | undefined {
  if (!KEYS.some((key) => params.has(PARAMS[key]))) return undefined
  const parsed = RequirementsSchema.safeParse(
    Object.fromEntries(
      KEYS.map((key) => {
        const text = params.get(PARAMS[key])
        return [
          key,
          text === null || text === 'none'
            ? null
            : text.trim() === ''
              ? Number.NaN
              : Number(text),
        ]
      }),
    ),
  )
  return parsed.success ? parsed.data : undefined
}

export function writeRequirements(
  params: URLSearchParams,
  requirements: Requirements | undefined,
): void {
  for (const key of KEYS)
    if (requirements)
      params.set(PARAMS[key], String(requirements[key] ?? 'none'))
    else params.delete(PARAMS[key])
}

/** 탐색 요청(docs/api.md 의 MissionRequest)에 넣을 한도. 없는 선택 한도는 필드를 보내지 않는다. */
export function requirementLimits(
  requirements: Requirements,
): Pick<
  MissionRequest,
  | 'min_sunlight_fraction'
  | 'min_communication_fraction'
  | 'max_continuous_darkness_hours'
  | 'max_communication_blackout_hours'
  | 'max_terrain_roughness_m'
> {
  return {
    ...(requirements.minSunPercent === null
      ? {}
      : { min_sunlight_fraction: requirements.minSunPercent / 100 }),
    ...(requirements.minCommPercent === null
      ? {}
      : { min_communication_fraction: requirements.minCommPercent / 100 }),
    max_continuous_darkness_hours: requirements.maxDarknessHours,
    max_communication_blackout_hours: requirements.maxBlackoutHours,
    ...(requirements.maxRoughnessM === null
      ? {}
      : { max_terrain_roughness_m: requirements.maxRoughnessM }),
  }
}
