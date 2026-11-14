import type { Analysis, AnalysisParams, Period } from '../api/analysis'

// 화면용 순수 계산 모음 (UI 컴포넌트와 분리해 테스트한다).

type Metrics = Analysis['metrics']
type Horizon = Analysis['horizon']

const MS_PER_HOUR = 3_600_000

export function durationHours(period: Period): number {
  return (Date.parse(period.end) - Date.parse(period.start)) / MS_PER_HOUR
}

export function longestPeriod(periods: readonly Period[]): Period | null {
  let best: Period | null = null
  let bestHours = -Infinity
  for (const period of periods) {
    const hours = durationHours(period)
    if (hours > bestHours) {
      best = period
      bestHours = hours
    }
  }
  return best
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(1)))
}

export function formatDuration(hours: number): string {
  const total = Math.round(hours * 10) / 10
  const days = Math.floor(total / 24)
  const rest = Math.round((total - days * 24) * 10) / 10
  if (days === 0) return `${trimNumber(total)}시간`
  return rest === 0 ? `${days}일` : `${days}일 ${trimNumber(rest)}시간`
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

export function formatUtc(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`
}

// ---------- 구간 테이블 ----------

export interface PeriodRow {
  kind: 'window' | 'dark'
  start: string
  end: string
  hours: number
}

export type SortKey = 'start' | 'hours'
export type SortDir = 'asc' | 'desc'

export function toPeriodRows(
  periods: readonly Period[],
  kind: PeriodRow['kind'],
): PeriodRow[] {
  return periods.map((period) => ({
    kind,
    start: period.start,
    end: period.end,
    hours: durationHours(period),
  }))
}

export function sortPeriodRows(
  rows: readonly PeriodRow[],
  key: SortKey,
  dir: SortDir,
): PeriodRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return rows.toSorted((a, b) => {
    const diff =
      key === 'hours'
        ? a.hours - b.hours
        : Date.parse(a.start) - Date.parse(b.start)
    return diff * sign
  })
}

// ---------- 기준(threshold) 판정 ----------

export interface Thresholds {
  minVisibleFraction?: number
  maxDarkHours?: number
}

export interface Check {
  id: 'visible_fraction' | 'longest_dark'
  label: string
  pass: boolean
  reason: string
}

export function evaluateThresholds(
  metrics: Metrics,
  thresholds: Thresholds,
): Check[] {
  const checks: Check[] = []
  if (thresholds.minVisibleFraction !== undefined) {
    const pass = metrics.visible_fraction >= thresholds.minVisibleFraction
    const actual = formatPercent(metrics.visible_fraction)
    const need = formatPercent(thresholds.minVisibleFraction)
    checks.push({
      id: 'visible_fraction',
      label: `가시율 ≥ ${need}`,
      pass,
      reason: pass
        ? `가시율 ${actual}로 기준 ${need} 이상입니다.`
        : `가시율 ${actual}로 기준 ${need}에 못 미칩니다.`,
    })
  }
  if (thresholds.maxDarkHours !== undefined) {
    const pass = metrics.longest_dark_hours <= thresholds.maxDarkHours
    const actual = formatDuration(metrics.longest_dark_hours)
    const limit = formatDuration(thresholds.maxDarkHours)
    checks.push({
      id: 'longest_dark',
      label: `최장 연속 암흑 ≤ ${limit}`,
      pass,
      reason: pass
        ? `최장 연속 암흑 ${actual}로 허용 ${limit} 이내입니다.`
        : `최장 연속 암흑 ${actual}로 허용 ${limit}을 넘습니다.`,
    })
  }
  return checks
}

// ---------- 기하 ----------

/** 방위각(0°=북, 시계방향)에서 수평선 고각을 선형 보간한다. 360° 경계는 이어 붙인다. */
export function horizonAtAzimuth(horizon: Horizon, azimuthDeg: number): number {
  const az = horizon.azimuth_deg
  const el = horizon.elevation_deg
  const n = az.length
  if (n === 0) return 0
  const target = ((azimuthDeg % 360) + 360) % 360
  let lo = 0
  let hi = n - 1
  // az 는 오름차순. target 이하인 마지막 인덱스를 찾는다.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if ((az[mid] ?? 0) <= target) lo = mid
    else hi = mid - 1
  }
  const a0 = az[lo] ?? 0
  const e0 = el[lo] ?? 0
  const nextIndex = lo + 1 < n ? lo + 1 : 0
  const a1 = lo + 1 < n ? (az[nextIndex] ?? 0) : (az[0] ?? 0) + 360
  const e1 = el[nextIndex] ?? 0
  if (target < a0) return e0 // 첫 샘플 앞(배열이 0°에서 시작하지 않는 경우)
  const span = a1 - a0
  if (span <= 0) return e0
  return e0 + ((e1 - e0) * (target - a0)) / span
}

/** 방위각(0°=북, 시계방향)과 반지름을 SVG 좌표(북쪽이 위)로 바꾼다. */
export function polarToXY(
  azimuthDeg: number,
  radius: number,
): { x: number; y: number } {
  const rad = (azimuthDeg * Math.PI) / 180
  return { x: radius * Math.sin(rad), y: -radius * Math.cos(rad) }
}

/** 긴 시계열을 그릴 점 개수로 줄인다. 첫·끝 점은 유지. */
export function decimateIndices(length: number, max: number): number[] {
  if (length <= max) return Array.from({ length }, (_, i) => i)
  const out: number[] = []
  const step = (length - 1) / (max - 1)
  let previous = -1
  for (let i = 0; i < max; i += 1) {
    const index = Math.round(i * step)
    if (index !== previous) out.push(index)
    previous = index
  }
  return out
}

/** 오름차순 배열에서 값에 가장 가까운 인덱스. */
export function nearestIndex(sorted: readonly number[], value: number): number {
  let lo = 0
  let hi = sorted.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if ((sorted[mid] ?? 0) < value) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && value - (sorted[lo - 1] ?? 0) <= (sorted[lo] ?? 0) - value) {
    return lo - 1
  }
  return lo
}

// ---------- 폼 검증 ----------

export interface FormValues {
  lat: string
  lon: string
  start: string
  end: string
  stepMinutes: string
  observerHeightM: string
}

export type FormErrors = Partial<Record<keyof FormValues, string>>

export type ParseResult =
  { ok: true; params: AnalysisParams } | { ok: false; errors: FormErrors }

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
const MAX_RANGE_DAYS = 3 * 366

function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function parseUtc(raw: string): { iso: string; ms: number } | null {
  if (!LOCAL_DATETIME.test(raw)) return null
  const withSeconds = raw.length === 16 ? `${raw}:00` : raw
  const iso = `${withSeconds}Z`
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : { iso, ms }
}

/** docs/api.md 의 쿼리 제약을 그대로 미러링한다 (서버가 최종 검증). */
export function parseForm(values: FormValues): ParseResult {
  const errors: FormErrors = {}

  const lat = parseNumber(values.lat)
  if (lat === null || lat < -90 || lat > -80) {
    errors.lat = '위도는 -90 ~ -80 사이여야 합니다 (남극 지역).'
  }
  const lon = parseNumber(values.lon)
  if (lon === null || lon < -180 || lon > 360) {
    errors.lon = '경도는 -180 ~ 360 사이의 숫자여야 합니다 (동경 기준).'
  }
  const step = parseNumber(values.stepMinutes)
  if (step === null || !Number.isInteger(step) || step < 5 || step > 360) {
    errors.stepMinutes = '간격은 5 ~ 360분 사이의 정수여야 합니다.'
  }
  const height = parseNumber(values.observerHeightM)
  if (height === null || height < 0 || height > 100) {
    errors.observerHeightM = '관측 높이는 0 ~ 100 m 사이여야 합니다.'
  }
  const start = parseUtc(values.start)
  if (start === null) errors.start = '시작 시각을 입력하세요 (UTC).'
  const end = parseUtc(values.end)
  if (end === null) {
    errors.end = '끝 시각을 입력하세요 (UTC).'
  } else if (start !== null) {
    if (end.ms <= start.ms) {
      errors.end = '끝 시각은 시작 시각보다 뒤여야 합니다.'
    } else if ((end.ms - start.ms) / (24 * MS_PER_HOUR) > MAX_RANGE_DAYS) {
      errors.end = '분석 기간은 최대 3년입니다.'
    }
  }

  if (
    Object.keys(errors).length > 0 ||
    lat === null ||
    lon === null ||
    step === null ||
    height === null ||
    start === null ||
    end === null
  ) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    params: {
      lat,
      lon,
      start: start.iso,
      end: end.iso,
      step_minutes: step,
      observer_height_m: height,
    },
  }
}

// ---------- 축 눈금 ----------

/** [min, max] 안에 들어가는 보기 좋은 눈금 (1·2·5 × 10^n 간격). */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min]
  const rough = (max - min) / Math.max(1, target)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const step = factor * magnitude
  const ticks: number[] = []
  const first = Math.ceil(min / step) * step
  for (let value = first; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toFixed(10)))
  }
  return ticks
}

// ---------- 기준 입력 ----------

export interface ThresholdInputs {
  minVisiblePercent: string
  maxDarkHours: string
}

export interface ThresholdParse {
  thresholds: Thresholds
  errors: Partial<Record<keyof ThresholdInputs, string>>
}

/** 빈 칸은 "기준 없음". 잘못된 값은 오류로 알리고 해당 기준은 적용하지 않는다. */
export function parseThresholds(inputs: ThresholdInputs): ThresholdParse {
  const thresholds: Thresholds = {}
  const errors: ThresholdParse['errors'] = {}

  if (inputs.minVisiblePercent.trim() !== '') {
    const percent = parseNumber(inputs.minVisiblePercent)
    if (percent === null || percent < 0 || percent > 100) {
      errors.minVisiblePercent = '0 ~ 100 사이의 숫자를 입력하세요.'
    } else {
      thresholds.minVisibleFraction = percent / 100
    }
  }
  if (inputs.maxDarkHours.trim() !== '') {
    const hours = parseNumber(inputs.maxDarkHours)
    if (hours === null || hours < 0) {
      errors.maxDarkHours = '0 이상의 숫자를 입력하세요.'
    } else {
      thresholds.maxDarkHours = hours
    }
  }
  return { thresholds, errors }
}
