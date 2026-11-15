import { z } from 'zod'
import {
  ApiError,
  DEFAULT_BASE_URL,
  getJson,
  type RequestOptions,
} from './client'

// 응답 스키마는 docs/api.md 의 "후보지 탐색 결과 (/candidates)" 와 일치해야 한다.
// 지표가 계산되지 않은 곳은 null 이다. null 을 0 으로 바꾸지 않는다.

const Iso = z.iso.datetime({ offset: true })
const NullableNumber = z.number().nullable()

const WindowSchema = z.object({
  start: Iso,
  end: Iso,
  step_minutes: z.number(),
})

export const RunSummarySchema = z.object({
  id: z.string(),
  generated_at: Iso,
  dem: z.string(),
  window: WindowSchema,
  selected: z.number(),
  sampled_total: z.number(),
})
export type RunSummary = z.infer<typeof RunSummarySchema>

export const RunListSchema = z.object({ runs: z.array(RunSummarySchema) })

const SunMetricsSchema = z.object({
  fraction: NullableNumber,
  longest_dark_hours: NullableNumber,
  windows_per_24h: NullableNumber,
  mean_elevation_deg: NullableNumber,
})

const EarthMetricsSchema = z.object({
  fraction: NullableNumber,
  longest_blackout_hours: NullableNumber,
  windows_per_24h: NullableNumber,
  mean_elevation_deg: NullableNumber,
})

export const CandidateSchema = z.object({
  id: z.string(),
  rank: z.number(),
  lat_deg: z.number(),
  lon_deg: z.number(),
  x_m: z.number(),
  y_m: z.number(),
  grid_spacing_m: z.number(),
  terrain: z
    .object({
      slope_p95_deg: NullableNumber,
      coverage_fraction: z.number().min(0).max(1).nullable(),
      assessment_radius_m: z.number().positive(),
      slope_baseline_m: z.number().positive(),
      roughness_window_m: z.number().positive(),
      dem_pixel_m: z.number().positive(),
      landing_safety_status: z.literal('UNVERIFIED'),
    })
    .nullable()
    .optional(),
  sun: SunMetricsSchema,
  earth: EarthMetricsSchema,
  eligibility: z.object({
    status: z.enum(['eligible', 'excluded', 'unevaluated']),
    failed: z.array(z.string()),
    not_applied: z.array(z.string()),
  }),
  score: z.object({
    total: NullableNumber,
    sun_component: NullableNumber,
    earth_component: NullableNumber,
    components_used: z.number(),
  }),
  region_id: z.number(),
  data_quality: z.object({
    horizon_complete: z.boolean(),
    horizon_max_deg: NullableNumber,
    missing_metrics: z.array(z.string()),
    stage: z.enum(['fine', 'coarse']),
  }),
  selection: z.object({ picked_as: z.string(), note: z.string() }),
})
export type Candidate = z.infer<typeof CandidateSchema>

const ThresholdsSchema = z.object({
  min_sun_fraction: NullableNumber,
  max_sun_dark_hours: NullableNumber,
  min_earth_fraction: NullableNumber,
  max_earth_blackout_hours: NullableNumber,
  max_terrain_slope_degrees: NullableNumber.optional(),
})
export type SearchThresholds = z.infer<typeof ThresholdsSchema>

// SearchConfig 전체 중 화면이 쓰는 필드만 검증하고 나머지는 그대로 통과시킨다.
const ConfigSchema = z.looseObject({
  roi: z.object({ min_lat_deg: z.number(), max_lat_deg: z.number() }),
  grid_spacing_m: z.number(),
  coarse_spacing_m: NullableNumber,
  refine_fraction: z.number(),
  min_separation_m: z.number(),
  top_k: z.number(),
  thresholds: ThresholdsSchema,
  weights: z.object({ sun: z.number(), earth: z.number() }),
  window: WindowSchema,
  dem: z.string(),
  observer_height_m: z.number().default(0),
})
export type SearchConfig = z.infer<typeof ConfigSchema>

const DistributionSchema = z.record(z.string(), z.number())

// 사용자 임무 입력. docs/api.md 의 "POST /candidates/search" 요청 본문과 같다.
export const PrioritySchema = z.enum(['balanced', 'solar', 'earth'])
export type Priority = z.infer<typeof PrioritySchema>

export const MissionRequestSchema = z.object({
  landing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mission_duration_days: z.number().int(),
  max_continuous_darkness_hours: NullableNumber,
  max_communication_blackout_hours: NullableNumber,
  max_terrain_slope_degrees: NullableNumber,
  search_region: z.literal('south'),
  optimization_priority: PrioritySchema,
  observer_height_m: NullableNumber,
})
export type MissionRequest = z.infer<typeof MissionRequestSchema>

export const RunDetailSchema = z.object({
  id: z.string(),
  // 임무 입력으로 만든 실행이면 그 입력, 아니면 null (예전 방식의 실행은 필드가 없을 수 있다)
  mission: MissionRequestSchema.nullable().default(null),
  source: z.object({
    dem: z.object({
      name: z.string(),
      file: z.string(),
      sha256: z.string(),
      resolution_m: z.number(),
    }),
    spice_kernels: z.array(z.object({ name: z.string(), sha256: z.string() })),
    window: WindowSchema,
    projection: z.string(),
    plan_id: z.string(),
  }),
  config: ConfigSchema,
  summary: z.object({
    counts: z.record(z.string(), z.number()),
    reasons: z.record(z.string(), z.number()).default({}),
    distributions: z.record(z.string(), DistributionSchema),
    warnings: z.array(z.string()),
  }),
  run: z.object({
    generated_at: Iso,
    elapsed_seconds: z.number(),
    workers: z.number(),
    total_elapsed_seconds: z.number().nullable().default(null),
    started_at: z.string().nullable().default(null),
    completed_at: z.string().nullable().default(null),
  }),
  map: z.object({
    size_px: z.number().int().positive(),
    center_px: z.number(),
    pixel_size_m: z.number().positive(),
    rho_max_m: z.number().positive(),
    layers: z.array(z.string()),
  }),
  candidates: z.array(CandidateSchema),
})
export type RunDetail = z.infer<typeof RunDetailSchema>

/** 계약의 map.layers 이름. 순서는 지도에 쌓는 순서(아래 → 위)다. */
export const LAYER_NAMES = [
  'coarse_sun',
  'coarse_earth',
  'sun',
  'earth',
  'stage',
  'coarse_promoted',
  'eligibility',
  'regions',
  'quality',
] as const
export type LayerName = (typeof LAYER_NAMES)[number]

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/

export function isValidRunId(runId: string): boolean {
  return RUN_ID.test(runId)
}

export function runPath(runId: string): string {
  if (!isValidRunId(runId)) throw new Error(`잘못된 실행 ID: ${runId}`)
  return `/candidates/runs/${runId}`
}

/** 레이어 PNG 의 URL. 브라우저가 <img> 로 직접 읽으므로 API 기본 주소를 붙인다. */
export function layerUrl(
  runId: string,
  name: string,
  baseUrl: string = DEFAULT_BASE_URL,
): string {
  return `${baseUrl}${runPath(runId)}/layers/${name}.png`
}

export function fetchRuns(options?: RequestOptions) {
  return getJson('/candidates/runs', RunListSchema, options)
}

export function fetchRun(runId: string, options?: RequestOptions) {
  return getJson(runPath(runId), RunDetailSchema, options)
}

// ---------- 탐색 시작과 진행 상태 ----------

export const RunStateSchema = z.enum(['queued', 'running', 'done', 'failed'])
export type RunState = z.infer<typeof RunStateSchema>

export const SearchStartedSchema = z.object({
  run_id: z.string(),
  state: RunStateSchema,
  cached: z.boolean(),
})
export type SearchStarted = z.infer<typeof SearchStartedSchema>

export const RunStatusSchema = z.object({
  run_id: z.string(),
  state: RunStateSchema,
  stage: z.string(),
  done: z.number(),
  total: z.number(),
  error: z.string().nullable(),
  started_at: z.string().nullable(),
  updated_at: z.string(),
  completed_at: z.string().nullable().default(null),
  elapsed_seconds: z.number().nonnegative().nullable().default(null),
})
export type RunStatus = z.infer<typeof RunStatusSchema>

/** POST /candidates/search 의 결과. 예상할 수 있는 거절(409, 422)은 던지지 않고 값으로 돌려준다. */
export type StartOutcome =
  | { kind: 'started'; search: SearchStarted } // 202: 새 탐색을 시작했다
  | { kind: 'existing'; search: SearchStarted } // 200: 이전 결과(cached) 또는 이미 실행 중
  | { kind: 'busy'; message: string; runningRunId: string } // 409
  | { kind: 'invalid'; messages: string[] } // 422

const BusyDetailSchema = z.object({
  detail: z.object({ message: z.string(), running_run_id: z.string() }),
})

const FIELD_LABELS: Readonly<Record<string, string>> = {
  landing_date: '착륙 날짜',
  mission_duration_days: '임무 기간',
  max_continuous_darkness_hours: '최대 연속 암흑 시간',
  max_communication_blackout_hours: '최대 통신 두절 시간',
  max_terrain_slope_degrees: '최대 지형 경사',
  search_region: '탐색 영역',
  optimization_priority: '최적화 우선순위',
  observer_height_m: '관측·장비 높이',
}

/** 서버가 영어로 주는 검증 메시지 중 화면에서 흔한 것만 한국어로 바꾼다. 모르면 그대로 둔다. */
function translateServerMessage(raw: string): string {
  const msg = raw.replace(/^Value error, /, '')
  if (msg.includes('hybrid global search is planned'))
    return '하이브리드 전역 탐색은 계획 중이라 아직 쓸 수 없습니다.'
  if (msg.includes('inside the ephemeris coverage'))
    return '착륙 날짜와 임무 기간이 천체력 범위(1850~2150년)를 벗어납니다.'
  const ge = /greater than or equal to ([\d.]+)/.exec(msg)
  if (ge) return `${ge[1]} 이상이어야 합니다.`
  const le = /less than or equal to ([\d.]+)/.exec(msg)
  if (le) return `${le[1]} 이하여야 합니다.`
  const gt = /greater than ([\d.]+)/.exec(msg)
  if (gt) return `${gt[1]}보다 커야 합니다.`
  return msg
}

function validationMessages(detail: unknown): string[] {
  if (typeof detail === 'string') return [detail]
  const items = z
    .array(
      z.object({
        loc: z.array(z.union([z.string(), z.number()])).default([]),
        msg: z.string(),
      }),
    )
    .safeParse(detail)
  if (!items.success) return [JSON.stringify(detail)]
  return items.data.map((item) => {
    const field = item.loc[item.loc.length - 1]
    const label = typeof field === 'string' ? FIELD_LABELS[field] : undefined
    const text = translateServerMessage(item.msg)
    return label === undefined ? text : `${label}: ${text}`
  })
}

function detailText(body: unknown): string {
  const parsed = z.object({ detail: z.unknown() }).safeParse(body)
  if (!parsed.success) return ''
  const { detail } = parsed.data
  return typeof detail === 'string' ? detail : JSON.stringify(detail)
}

/** 응답 상태와 본문으로 결과를 가른다 (네트워크와 분리해 테스트한다). */
export function interpretStartResponse(
  status: number,
  body: unknown,
): StartOutcome {
  if (status === 200 || status === 202) {
    const parsed = SearchStartedSchema.safeParse(body)
    if (!parsed.success)
      throw new ApiError(
        'POST /candidates/search returned an unexpected shape',
        status,
      )
    return {
      kind: status === 202 ? 'started' : 'existing',
      search: parsed.data,
    }
  }
  if (status === 409) {
    const parsed = BusyDetailSchema.safeParse(body)
    if (!parsed.success)
      throw new ApiError(
        'POST /candidates/search returned an unexpected 409 body',
        status,
      )
    return {
      kind: 'busy',
      message: parsed.data.detail.message,
      runningRunId: parsed.data.detail.running_run_id,
    }
  }
  if (status === 422) {
    const detail = z.object({ detail: z.unknown() }).safeParse(body)
    return {
      kind: 'invalid',
      messages: detail.success
        ? validationMessages(detail.data.detail)
        : ['입력이 올바르지 않습니다.'],
    }
  }
  const extra = detailText(body)
  throw new ApiError(
    `POST /candidates/search failed with ${status}${extra === '' ? '' : `: ${extra}`}`,
    status,
  )
}

/** 임무 입력으로 탐색을 시작한다. 네트워크 오류와 예상 밖 상태는 던진다. */
export async function startSearch(
  request: MissionRequest,
  {
    baseUrl = DEFAULT_BASE_URL,
    fetchFn = fetch,
    signal,
    development = false,
  }: RequestOptions & { development?: boolean } = {},
): Promise<StartOutcome> {
  const response = await fetchFn(
    `${baseUrl}/candidates/search${development ? '/dev' : ''}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    },
  )
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null // JSON 이 아닌 오류 본문 (예: 프록시의 502 HTML)
  }
  return interpretStartResponse(response.status, body)
}

export function fetchRunStatus(runId: string, options?: RequestOptions) {
  return getJson(`${runPath(runId)}/status`, RunStatusSchema, options)
}
