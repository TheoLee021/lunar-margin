import type { MissionRequest, Priority } from '../api/candidates'

// 임무 입력 폼의 값과 검증. 화면의 입력 칸은 모두 문자열이고,
// 여기서 계약(docs/api.md 의 POST /candidates/search 요청 본문)의 JSON 으로 바꾼다.
// 비운 한도와 체크하지 않은 항목은 0 이 아니라 null 이다.

export interface MissionFormValues {
  landingDate: string
  durationDays: string
  maxDarknessHours: string
  maxBlackoutHours: string
  slopeEnabled: boolean
  slopeDegrees: string
  priority: Priority
  observerEnabled: boolean
  observerHeightM: string
}

/** 사용자가 제시한 입력 예시와 같은 값이다. */
export const DEFAULT_MISSION_VALUES: MissionFormValues = {
  landingDate: '2027-01-01',
  durationDays: '14',
  maxDarknessHours: '24',
  maxBlackoutHours: '6',
  slopeEnabled: true,
  slopeDegrees: '10',
  priority: 'balanced',
  observerEnabled: false,
  observerHeightM: '0',
}

export type MissionField =
  | 'landingDate'
  | 'durationDays'
  | 'maxDarknessHours'
  | 'maxBlackoutHours'
  | 'slopeDegrees'
  | 'observerHeightM'
export type MissionErrors = Partial<Record<MissionField, string>>

export type MissionParse =
  { ok: true; request: MissionRequest } | { ok: false; errors: MissionErrors }

const DAY_MS = 86_400_000
// 천체력(DE440s)이 덮는 범위. 서버도 같은 범위 밖의 임무를 거절한다.
const EPHEMERIS_START_MS = Date.UTC(1850, 0, 1)
const EPHEMERIS_END_MS = Date.UTC(2150, 0, 1)

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const INTEGER_PATTERN = /^\d+$/
const NUMBER_PATTERN = /^\d+(\.\d+)?$/

/** 'YYYY-MM-DD' 를 UTC 자정의 밀리초로. 없는 날짜(2월 30일 등)는 null. */
function dateMs(text: string): number | null {
  const match = DATE_PATTERN.exec(text)
  if (match === null) return null
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ]
  const ms = Date.UTC(year, month - 1, day)
  const back = new Date(ms)
  return back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day
    ? ms
    : null
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** 빈 칸이면 null(조건 없음), 0 이상의 숫자면 그 값. 그 밖은 undefined(잘못된 입력). */
function optionalNonNegative(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  return NUMBER_PATTERN.test(trimmed) ? Number(trimmed) : undefined
}

export function parseMissionForm(values: MissionFormValues): MissionParse {
  const errors: MissionErrors = {}

  const landingMs = dateMs(values.landingDate.trim())
  if (landingMs === null)
    errors.landingDate = '착륙 날짜를 YYYY-MM-DD 형식으로 입력하세요.'

  const durationText = values.durationDays.trim()
  const duration = INTEGER_PATTERN.test(durationText)
    ? Number(durationText)
    : null
  if (duration === null || duration < 1 || duration > 365)
    errors.durationDays = '임무 기간은 1~365 사이의 정수(일)여야 합니다.'

  if (landingMs !== null && errors.landingDate === undefined) {
    if (landingMs < EPHEMERIS_START_MS)
      errors.landingDate =
        '착륙 날짜는 1850년 이후여야 합니다 (천체력 범위 1850~2150년).'
    else if (
      duration !== null &&
      errors.durationDays === undefined &&
      landingMs + duration * DAY_MS > EPHEMERIS_END_MS
    )
      errors.landingDate =
        '착륙 날짜와 임무 기간이 천체력 범위(1850~2150년)를 벗어납니다. 2150년 1월 1일 전에 끝나야 합니다.'
  }

  const darkness = optionalNonNegative(values.maxDarknessHours)
  if (darkness === undefined)
    errors.maxDarknessHours =
      '0 이상의 숫자를 입력하세요 (비워 두면 조건 없음).'
  const blackout = optionalNonNegative(values.maxBlackoutHours)
  if (blackout === undefined)
    errors.maxBlackoutHours =
      '0 이상의 숫자를 입력하세요 (비워 두면 조건 없음).'

  let slope: number | null = null
  if (values.slopeEnabled) {
    const text = values.slopeDegrees.trim()
    const parsed = NUMBER_PATTERN.test(text) ? Number(text) : Number.NaN
    if (!(parsed > 0 && parsed <= 90))
      errors.slopeDegrees =
        '지형 경사는 0보다 크고 90 이하인 숫자(도)여야 합니다.'
    else slope = parsed
  }

  let observer: number | null = null
  if (values.observerEnabled) {
    const text = values.observerHeightM.trim()
    const parsed = NUMBER_PATTERN.test(text) ? Number(text) : Number.NaN
    if (!(parsed >= 0 && parsed <= 100))
      errors.observerHeightM =
        '관측·장비 높이는 0~100 사이의 숫자(m)여야 합니다.'
    else observer = parsed
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  if (duration === null || darkness === undefined || blackout === undefined)
    return { ok: false, errors } // 위 검증을 통과했다면 도달하지 않는다 (타입 좁히기용)

  return {
    ok: true,
    request: {
      landing_date: values.landingDate.trim(),
      mission_duration_days: duration,
      max_continuous_darkness_hours: darkness,
      max_communication_blackout_hours: blackout,
      max_terrain_slope_degrees: slope,
      search_region: 'south',
      optimization_priority: values.priority,
      observer_height_m: observer,
    },
  }
}

/** "임무 설정 복사"가 클립보드에 넣는 문자열. 계약의 예시와 같은 키·순서·형식이다. */
export function missionRequestJson(request: MissionRequest): string {
  return JSON.stringify(
    {
      landing_date: request.landing_date,
      mission_duration_days: request.mission_duration_days,
      max_continuous_darkness_hours: request.max_continuous_darkness_hours,
      max_communication_blackout_hours:
        request.max_communication_blackout_hours,
      max_terrain_slope_degrees: request.max_terrain_slope_degrees,
      search_region: request.search_region,
      optimization_priority: request.optimization_priority,
      observer_height_m: request.observer_height_m,
    },
    null,
    2,
  )
}

// ---------- 분석 기간 미리보기 ----------

export interface WindowPreview {
  startDate: string
  endDate: string // 끝 날짜는 포함하지 않는다
  days: number
}

/** 착륙 날짜부터 임무 기간 동안이 분석 기간이다. 입력이 쓸 수 없으면 null. */
export function windowPreview(
  landingDate: string,
  durationDays: number,
): WindowPreview | null {
  const start = dateMs(landingDate.trim())
  if (start === null || !Number.isInteger(durationDays) || durationDays < 1)
    return null
  return {
    startDate: isoDate(start),
    endDate: isoDate(start + durationDays * DAY_MS),
    days: durationDays,
  }
}

export function windowPreviewText(
  landingDate: string,
  durationDays: number,
): string | null {
  const preview = windowPreview(landingDate, durationDays)
  if (preview === null) return null
  return `${preview.startDate} ~ ${preview.endDate} (${preview.days}일, 끝 날짜는 포함하지 않음)`
}

// ---------- 표시 문구 ----------

const PRIORITY_COPY: Readonly<Record<Priority, string>> = {
  balanced: '균형 (일조 0.5 : 지구 0.5)',
  solar: '일조 우선 (일조 0.75 : 지구 0.25)',
  earth: '지구 가시성 우선 (일조 0.25 : 지구 0.75)',
}

export function priorityLabel(priority: Priority): string {
  return PRIORITY_COPY[priority]
}

function limitText(hours: number | null): string {
  return hours === null ? '조건 없음' : `${hours}시간 이하`
}

/** 결과 화면의 "입력한 임무 조건" 패널에 보여 줄 항목. */
export function missionSummaryItems(
  mission: MissionRequest,
): { label: string; value: string }[] {
  const preview = windowPreview(
    mission.landing_date,
    mission.mission_duration_days,
  )
  return [
    { label: '탐색 영역', value: '달 남극' },
    { label: '착륙 날짜', value: mission.landing_date },
    {
      label: '임무 기간',
      value:
        preview === null
          ? `${mission.mission_duration_days}일`
          : `${preview.days}일 (${preview.startDate} ~ ${preview.endDate})`,
    },
    {
      label: '최대 연속 암흑',
      value: limitText(mission.max_continuous_darkness_hours),
    },
    {
      label: '최대 통신 두절',
      value: limitText(mission.max_communication_blackout_hours),
    },
    {
      label: '최대 지형 경사',
      value:
        mission.max_terrain_slope_degrees === null
          ? '지정하지 않음'
          : `${mission.max_terrain_slope_degrees}° (적용되지 않음)`,
    },
    {
      label: '최적화 우선순위',
      value: priorityLabel(mission.optimization_priority),
    },
    {
      label: '관측·장비 높이',
      value:
        mission.observer_height_m === null
          ? '지표면 (0 m)'
          : `${mission.observer_height_m} m`,
    },
  ]
}
