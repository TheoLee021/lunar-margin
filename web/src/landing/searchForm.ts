import { DAY, dayOf, iso } from '../mission/missionDates'
import {
  DEFAULT_REQUIREMENTS,
  type Requirements,
} from '../mission/requirements'
import { DateSchema } from '../mission/scheduleSchema'
import type { MissionSelection } from '../mission/types'

// 검색 화면의 입력 값과 검증. 입력 칸은 모두 문자열이고, 비운 한도는 0이 아니라 null(조건 없음)이다.

export type SearchFormValues = {
  landing: string
  duration: string
  minSunPercent: string
  minCommPercent: string
  maxDarknessHours: string
  maxBlackoutHours: string
  maxSlopeDeg: string
  maxRoughnessM: string
}
export type SearchField = keyof SearchFormValues
export type SearchErrors = Partial<Record<SearchField, string>>

/** 검색 화면이 정하는 것: 표면 임무 기간과 후보지가 만족해야 하는 한도. */
export type SearchConditions = {
  landing: string
  duration: number
  maxSlope: number | null
  requirements: Requirements
}
export type SearchParse =
  { ok: true; search: SearchConditions } | { ok: false; errors: SearchErrors }

/** 일정 화면이 다루는 표면 임무 기간과 같다 (ScheduleSchema). */
export const DURATIONS = [7, 14, 28] as const
// 착륙일만 정한 상태의 출발일. 실제 출발일은 다음 단계(일정·비용)에서 고른다.
const DEFAULT_TRANSIT_DAYS = 4
// 천체력(DE440s)이 덮는 범위. 서버도 같은 범위 밖의 임무를 거절한다.
const EPHEMERIS_START_MS = Date.UTC(1850, 0, 1)
const EPHEMERIS_END_MS = Date.UTC(2150, 0, 1)
const NUMBER_PATTERN = /^\d+(\.\d+)?$/

/** 빈 칸이면 null(조건 없음), 범위 안의 숫자면 그 값, 그 밖은 undefined(잘못된 입력). */
function limit(
  text: string,
  accepts: (value: number) => boolean,
): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!NUMBER_PATTERN.test(trimmed)) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) && accepts(value) ? value : undefined
}

export function parseSearchForm(values: SearchFormValues): SearchParse {
  const errors: SearchErrors = {}

  const duration = DURATIONS.find((days) => String(days) === values.duration)
  if (duration === undefined)
    errors.duration = 'Choose a mission duration of 7, 14 or 28 days.'

  const landing = values.landing.trim()
  if (!DateSchema.safeParse(landing).success)
    errors.landing = 'Enter the landing date as YYYY-MM-DD.'
  else {
    const start = Date.parse(landing)
    if (
      start < EPHEMERIS_START_MS ||
      start + (duration ?? 0) * DAY > EPHEMERIS_END_MS
    )
      errors.landing =
        'The mission must stay inside the ephemeris coverage (1850–2150).'
  }

  const percent = (value: number) => value <= 100
  const any = () => true
  const minSunPercent = limit(values.minSunPercent, percent)
  if (minSunPercent === undefined)
    errors.minSunPercent = 'Enter a percentage from 0 to 100.'
  const minCommPercent = limit(values.minCommPercent, percent)
  if (minCommPercent === undefined)
    errors.minCommPercent = 'Enter a percentage from 0 to 100.'
  const maxDarknessHours = limit(values.maxDarknessHours, any)
  if (maxDarknessHours === undefined)
    errors.maxDarknessHours = 'Enter a number of hours, 0 or more.'
  const maxBlackoutHours = limit(values.maxBlackoutHours, any)
  if (maxBlackoutHours === undefined)
    errors.maxBlackoutHours = 'Enter a number of hours, 0 or more.'
  const maxSlope = limit(
    values.maxSlopeDeg,
    (value) => value > 0 && value <= 90,
  )
  if (maxSlope === undefined)
    errors.maxSlopeDeg = 'Enter an angle above 0° and up to 90°.'
  const maxRoughnessM = limit(values.maxRoughnessM, any)
  if (maxRoughnessM === undefined)
    errors.maxRoughnessM = 'Enter a length in metres, 0 or more.'

  if (
    duration === undefined ||
    minSunPercent === undefined ||
    minCommPercent === undefined ||
    maxDarknessHours === undefined ||
    maxBlackoutHours === undefined ||
    maxSlope === undefined ||
    maxRoughnessM === undefined ||
    errors.landing !== undefined
  )
    return { ok: false, errors }
  return {
    ok: true,
    search: {
      landing,
      duration,
      maxSlope,
      requirements: {
        minSunPercent,
        minCommPercent,
        maxDarknessHours,
        maxBlackoutHours,
        maxRoughnessM,
      },
    },
  }
}

const text = (value: number | null | undefined) =>
  value == null ? '' : String(value)

/** 지금 선택으로 폼을 채운다. 검색한 적이 없으면 날짜 계획의 기본 한도에서 시작한다. */
export function searchFormValues(
  selection: MissionSelection,
): SearchFormValues {
  const requirements = selection.requirements ?? DEFAULT_REQUIREMENTS
  return {
    landing: selection.landing,
    duration: String(selection.duration),
    minSunPercent: text(requirements.minSunPercent),
    minCommPercent: text(requirements.minCommPercent),
    maxDarknessHours: text(requirements.maxDarknessHours),
    maxBlackoutHours: text(requirements.maxBlackoutHours),
    maxSlopeDeg: text(selection.maxSlope),
    maxRoughnessM: text(requirements.maxRoughnessM),
  }
}

/**
 * 검색 조건을 공용 선택에 반영한다. 착륙일이 바뀌면 출발일과 발사편은 더 이상 맞지 않고,
 * 표면 임무 기간이 바뀌면 고른 후보지도 그 기간의 결과가 아니다.
 */
export function applySearch(
  selection: MissionSelection,
  search: SearchConditions,
): MissionSelection {
  const sameLanding = selection.landing === search.landing
  return {
    ...selection,
    ...(sameLanding
      ? {}
      : {
          departure: iso(dayOf(search.landing) - DEFAULT_TRANSIT_DAYS),
          launchId: null,
        }),
    landing: search.landing,
    duration: search.duration,
    maxSlope: search.maxSlope,
    requirements: search.requirements,
    siteId:
      sameLanding && selection.duration === search.duration
        ? selection.siteId
        : null,
  }
}
