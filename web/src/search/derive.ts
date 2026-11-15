import type { Candidate, LayerName, SearchThresholds } from '../api/candidates'
import { LAYER_NAMES } from '../api/candidates'
import { formatDuration } from '../analysis/derive'

// ---------- 투영 (docs/api.md 의 변환식) ----------

const MOON_RADIUS_M = 1_737_400
const DEG = Math.PI / 180

export interface MapGeometry {
  size_px: number
  center_px: number
  pixel_size_m: number
  rho_max_m: number
}

/** 투영 좌표(m) → 위경도. 경도는 [0, 360). */
export function xyToLonLat(x: number, y: number): { lat: number; lon: number } {
  const rho = Math.hypot(x, y)
  const lat = -90 + (2 * Math.atan(rho / (2 * MOON_RADIUS_M))) / DEG
  const lon = (((Math.atan2(x, y) / DEG) % 360) + 360) % 360
  return { lat, lon }
}

/** 위경도 → 투영 좌표(m). xyToLonLat 의 역변환이다. */
export function lonLatToXy(lat: number, lon: number): { x: number; y: number } {
  const rho = 2 * MOON_RADIUS_M * Math.tan(((90 + lat) * DEG) / 2)
  return { x: rho * Math.sin(lon * DEG), y: rho * Math.cos(lon * DEG) }
}

/**
 * 이미지 좌표(연속, 왼쪽 위가 0)를 투영 좌표(m)로 바꾼다.
 * 계약: 픽셀 (col,row) 의 x = (col - center)*pixel, y = (center - row)*pixel.
 * 픽셀 중심은 이미지 좌표에서 col + 0.5 이므로 0.5 를 뺀다.
 */
export function imageToXy(
  u: number,
  v: number,
  map: MapGeometry,
): { x_m: number; y_m: number } {
  return {
    x_m: (u - 0.5 - map.center_px) * map.pixel_size_m,
    y_m: (map.center_px - (v - 0.5)) * map.pixel_size_m,
  }
}

export function xyToImage(
  x_m: number,
  y_m: number,
  map: MapGeometry,
): { u: number; v: number } {
  return {
    u: x_m / map.pixel_size_m + map.center_px + 0.5,
    v: map.center_px - y_m / map.pixel_size_m + 0.5,
  }
}

export function isInsideRoi(x_m: number, y_m: number, map: MapGeometry) {
  return Math.hypot(x_m, y_m) <= map.rho_max_m
}

// ---------- 집계 ----------

/** 없는 항목은 0이 아니라 null 이다. */
export function count(
  counts: Readonly<Record<string, number>>,
  key: string,
): number | null {
  const value = counts[key]
  return value === undefined ? null : value
}

export interface FunnelStep {
  id: 'sampled' | 'computed' | 'eligible' | 'in_regions' | 'selected'
  label: string
  hint: string
  value: number
}

/**
 * 퍼널: 샘플 → 계산됨 → 적격 → 영역에 속한 점 → 선정.
 * 연결 영역은 세밀 단계의 적격 점에서만 만들어진다. 세밀화되지 않은 적격 점은
 * reasons.not_refined 로 세어지므로 (적격 - not_refined) 가 영역에 속한 점 수다.
 */
export function funnelSteps(
  counts: Readonly<Record<string, number>>,
  reasons: Readonly<Record<string, number>>,
): FunnelStep[] {
  const steps: FunnelStep[] = []
  const sampled = count(counts, 'sampled_total')
  const computed = count(counts, 'computed')
  const eligible = count(counts, 'eligible')
  const selected = count(counts, 'selected')
  if (sampled !== null)
    steps.push({
      id: 'sampled',
      label: '샘플로 뽑은 점',
      hint: '거친 격자와 세밀 격자에서 계산하려고 고른 모든 점',
      value: sampled,
    })
  if (computed !== null)
    steps.push({
      id: 'computed',
      label: '지표를 계산한 점',
      hint: '높이 지도(DEM) 안에 있어 일조·지구 가시성을 계산한 점',
      value: computed,
    })
  if (eligible !== null)
    steps.push({
      id: 'eligible',
      label: '조건을 통과한 점',
      hint: '필수 조건(임계값)에 걸리지 않은 점',
      value: eligible,
    })
  // 서버가 in_regions 를 직접 주면 그 값을, 예전 결과에는 (적격 - 세밀화되지 않은 적격)으로 계산한다.
  const inRegions = count(counts, 'in_regions')
  const notRefined = reasons['not_refined']
  const regionPoints =
    inRegions !== null
      ? inRegions
      : eligible !== null && notRefined !== undefined
        ? Math.max(eligible - notRefined, 0)
        : null
  if (regionPoints !== null)
    steps.push({
      id: 'in_regions',
      label: '연결 영역에 속한 점',
      hint: '세밀하게 다시 계산한 적격 점. 이 점들만 영역으로 묶고 대표를 뽑습니다',
      value: regionPoints,
    })
  if (selected !== null)
    steps.push({
      id: 'selected',
      label: '선정된 후보',
      hint: '영역마다 대표를 뽑고 최소 간격과 Top-K를 적용한 결과',
      value: selected,
    })
  return steps
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  rf_incomplete: 'RF 통신 지표를 계산하지 못함',
  rf_fraction_below_min: 'RF 통신 가능 비율이 최소 기준보다 낮음',
  rf_blackout_hours_above_max: 'RF 최장 두절이 허용 시간보다 김',
  sun_fraction_below_min: '일조율이 최소 기준보다 낮음',
  sun_dark_hours_above_max: '최장 암흑이 허용 시간보다 김',
  earth_fraction_below_min: '지구 가시율이 최소 기준보다 낮음',
  earth_blackout_hours_above_max: '최장 지구 LOS 차폐가 허용 시간보다 김',
  horizon_incomplete: '수평선이 높이 지도 밖으로 나가 제외',
  terrain_slope_above_max: '250 m 지역 경사 P95가 허용 경사보다 큼',
  terrain_incomplete: '지역 지형 자료가 불완전하여 판정 불가',
  terrain_roughness_above_max: '250 m 지역 거칠기 P95가 허용 한도를 넘음',
  no_metrics: '지표를 계산하지 못함',
  not_refined: '세밀화 대상이 아니라 거친 값으로 남음',
  within_min_separation: '이미 뽑힌 후보와 너무 가까움',
  beyond_top_k: '후보 수(Top-K) 한도 밖',
}

export function reasonLabel(key: string): string {
  return REASON_LABELS[key] ?? key
}

export function shortHash(sha: string): string {
  return sha.length === 0 ? '—' : `${sha.slice(0, 8)}…`
}

export function allThresholdsNull(thresholds: SearchThresholds): boolean {
  return Object.values(thresholds).every((value) => value === null)
}

// ---------- 표시 형식 (null 은 '—') ----------

export function fractionText(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

export function hoursText(value: number | null): string {
  return value === null ? '—' : formatDuration(value)
}

export function scoreText(value: number | null): string {
  return value === null ? '—' : value.toFixed(3)
}

export function degText(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}°`
}

// ---------- 단계 ----------

export type StepId =
  'coarse' | 'refine' | 'fine' | 'filter' | 'regions' | 'select'
export type Metric = 'sun' | 'earth'

export interface StepInfo {
  id: StepId
  title: string
}

export const STEPS: readonly StepInfo[] = [
  { id: 'coarse', title: '거친 격자' },
  { id: 'refine', title: '세밀화 영역' },
  { id: 'fine', title: '세밀 결과' },
  { id: 'filter', title: '필터' },
  { id: 'regions', title: '연결 영역' },
  { id: 'select', title: '선정 후보' },
]

export interface LayerPreset {
  name: LayerName
  opacity: number
}

/** 단계마다 기본으로 보여 줄 레이어와 투명도 (계약의 레이어 표). */
export function stepLayers(step: StepId, metric: Metric): LayerPreset[] {
  const coarse: LayerName = metric === 'sun' ? 'coarse_sun' : 'coarse_earth'
  const fine: LayerName = metric === 'sun' ? 'sun' : 'earth'
  switch (step) {
    case 'coarse':
      return [{ name: coarse, opacity: 1 }]
    case 'refine':
      return [
        { name: coarse, opacity: 0.55 },
        { name: 'coarse_promoted', opacity: 0.9 },
      ]
    case 'fine':
      return [{ name: fine, opacity: 1 }]
    case 'filter':
      return [
        { name: fine, opacity: 0.45 },
        { name: 'eligibility', opacity: 0.85 },
      ]
    case 'regions':
      return [
        { name: fine, opacity: 0.35 },
        { name: 'regions', opacity: 0.9 },
      ]
    case 'select':
      return [
        { name: fine, opacity: 0.7 },
        { name: 'regions', opacity: 0.3 },
      ]
  }
}

export interface LayerState {
  on: boolean
  opacity: number
}
export type LayerStates = Readonly<Record<LayerName, LayerState>>

export const LAYER_LABELS: Readonly<Record<LayerName, string>> = {
  coarse_sun: '거친 격자 · 일조율',
  coarse_earth: '거친 격자 · 지구 가시율',
  coarse_promoted: '세밀화로 고른 영역',
  sun: '최종 · 일조율',
  earth: '최종 · 지구 가시율',
  stage: '세밀 / 거친 값 구분',
  eligibility: '적격 여부',
  regions: '연결 영역',
  quality: '수평선 불완전(주황)',
}

/**
 * 단계의 기본 레이어 설정에서 모든 레이어의 상태를 만든다.
 * 서버가 주지 않은 레이어(available 에 없음)는 항상 꺼진다.
 */
export function layerStatesFor(
  presets: readonly LayerPreset[],
  available: readonly string[],
): LayerStates {
  const states = {} as Record<LayerName, LayerState>
  for (const name of LAYER_NAMES) {
    const preset = presets.find((p) => p.name === name)
    states[name] = {
      on: preset !== undefined && available.includes(name),
      opacity: preset?.opacity ?? 0.8,
    }
  }
  return states
}

/** 쌓는 순서(아래 → 위)대로 정렬한다. */
export function layerStackOrder(names: readonly LayerName[]): LayerName[] {
  return LAYER_NAMES.filter((name) => names.includes(name))
}

/** 한 칸 이동. 처음·끝을 넘으면 null (재생은 끝에서 멈춘다). */
export function nextStepIndex(
  index: number,
  delta: 1 | -1,
  total: number,
): number | null {
  const next = index + delta
  return next < 0 || next >= total ? null : next
}

// ---------- 후보 표 ----------

export type SortKey =
  | 'rank'
  | 'id'
  | 'lat'
  | 'lon'
  | 'sun'
  | 'earth'
  | 'roughness'
  | 'rf'
  | 'rfBlackout'
  | 'slope'
  | 'score'
  | 'region'
export type SortDir = 'asc' | 'desc'

function sortValue(candidate: Candidate, key: SortKey): number | string | null {
  switch (key) {
    case 'rank':
      return candidate.rank
    case 'id':
      return candidate.id
    case 'lat':
      return candidate.lat_deg
    case 'lon':
      return candidate.lon_deg
    case 'sun':
      return candidate.sun.fraction
    case 'earth':
      return candidate.earth.fraction
    case 'roughness':
      return candidate.terrain?.roughness_p95_m ?? null
    case 'rf':
      return candidate.rf?.fraction ?? null
    case 'rfBlackout':
      return candidate.rf?.longest_blackout_hours ?? null
    case 'slope':
      return candidate.terrain?.slope_p95_deg ?? null
    case 'score':
      return candidate.score.total
    case 'region':
      return candidate.region_id
  }
}

/** 값이 없는(null) 행은 정렬 방향과 상관없이 맨 아래에 둔다. 입력은 바꾸지 않는다. */
export function sortCandidates(
  rows: readonly Candidate[],
  key: SortKey,
  dir: SortDir,
): Candidate[] {
  const sign = dir === 'asc' ? 1 : -1
  return rows.toSorted((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    if (va === null && vb === null) return a.rank - b.rank
    if (va === null) return 1
    if (vb === null) return -1
    const order =
      typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb)
        : Number(va) - Number(vb)
    return order === 0 ? a.rank - b.rank : order * sign
  })
}

// ---------- 후보 상세 분석 기간 ----------

function isoUtc(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}

/**
 * 후보를 자세히 볼 때 쓰는 기간: 실행 기간의 시작부터 1년.
 * (분석 API 는 한 번에 3년·10만 표본까지라 19년 전체는 요청할 수 없다.)
 * 2월 29일에서 시작하면 다음 해 2월 28일로 맞춘다.
 */
export function oneYearFrom(startIso: string): { start: string; end: string } {
  const start = new Date(startIso)
  const y = start.getUTCFullYear()
  const m = start.getUTCMonth()
  const d = start.getUTCDate()
  const time =
    start.getUTCHours() * 3_600_000 +
    start.getUTCMinutes() * 60_000 +
    start.getUTCSeconds() * 1_000
  let end = Date.UTC(y + 1, m, d)
  if (new Date(end).getUTCMonth() !== m) end = Date.UTC(y + 1, m + 1, 0)
  return { start: isoUtc(start.getTime()), end: isoUtc(end + time) }
}

const YEAR_LIMIT_MS = 366 * 86_400_000

/** 분석 기간 (계약의 window 와 같은 모양. 간격은 있어도 되고 없어도 된다). */
export interface WindowLike {
  start: string
  end: string
  step_minutes?: number
}

/**
 * 후보나 지점을 자세히 볼 때 쓰는 기간. 실행 기간이 1년 이하(임무 기간 같은 짧은 창)면 그 기간
 * 전체를, 더 길면 시작부터 1년을 쓴다. (분석 API 는 한 번에 3년·10만 표본까지다.)
 */
export function detailPeriod(window: WindowLike): {
  start: string
  end: string
} {
  const startMs = Date.parse(window.start)
  const endMs = Date.parse(window.end)
  if (endMs - startMs <= YEAR_LIMIT_MS)
    return { start: isoUtc(startMs), end: isoUtc(endMs) }
  return oneYearFrom(window.start)
}

/** "…를 태양과 지구 모두 계산합니다" 앞에 붙는 구절. */
export function detailPeriodText(window: WindowLike): string {
  const startDay = window.start.slice(0, 10)
  const spanMs = Date.parse(window.end) - Date.parse(window.start)
  if (spanMs <= YEAR_LIMIT_MS)
    return `${startDay}부터 임무 기간 전체(${Math.round(spanMs / 86_400_000)}일)를`
  return `${startDay}부터 1년을`
}
