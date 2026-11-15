import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import {
  MissionRequestSchema,
  RunDetailSchema,
  RunStatusSchema,
  SearchStartedSchema,
  fetchRunStatus,
  interpretStartResponse,
  startSearch,
  type MissionRequest,
} from './candidates'

// 계약의 요청 본문 예시 그대로
const EXAMPLE: MissionRequest = {
  landing_date: '2027-01-01',
  mission_duration_days: 14,
  max_continuous_darkness_hours: 24,
  max_communication_blackout_hours: 6,
  max_terrain_slope_degrees: 10,
  search_region: 'south',
  optimization_priority: 'balanced',
  observer_height_m: null,
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('MissionRequestSchema', () => {
  it('accepts the contract example and keeps null as null', () => {
    const parsed = MissionRequestSchema.parse(EXAMPLE)

    expect(parsed.observer_height_m).toBeNull()
    expect(parsed.max_terrain_slope_degrees).toBe(10)
  })

  it('accepts unset limits (null) and rejects unknown priorities or regions', () => {
    expect(
      MissionRequestSchema.safeParse({
        ...EXAMPLE,
        max_continuous_darkness_hours: null,
        max_communication_blackout_hours: null,
      }).success,
    ).toBe(true)
    expect(
      MissionRequestSchema.safeParse({
        ...EXAMPLE,
        optimization_priority: 'fast',
      }).success,
    ).toBe(false)
    expect(
      MissionRequestSchema.safeParse({ ...EXAMPLE, search_region: 'global' })
        .success,
    ).toBe(false)
  })
})

describe('SearchStartedSchema and RunStatusSchema', () => {
  it('parses the contract responses', () => {
    expect(
      SearchStartedSchema.parse({
        run_id: 'm-3f9a1c0b2d',
        state: 'queued',
        cached: false,
      }),
    ).toEqual({ run_id: 'm-3f9a1c0b2d', state: 'queued', cached: false })

    const status = RunStatusSchema.parse({
      run_id: 'm-3f9a1c0b2d',
      state: 'running',
      stage: 'fine',
      done: 41200,
      total: 119037,
      error: null,
      started_at: '2026-11-14T21:03:10+00:00',
      updated_at: '2026-11-14T21:05:02+00:00',
    })
    expect(status.done).toBe(41200)
    expect(status.error).toBeNull()
  })

  it('allows a missing start time (older runs) and rejects unknown states', () => {
    const base = {
      run_id: 'default',
      state: 'done',
      stage: 'done',
      done: 0,
      total: 0,
      error: null,
      started_at: null,
      updated_at: '2026-11-14T21:05:02+00:00',
    }
    expect(RunStatusSchema.safeParse(base).success).toBe(true)
    expect(
      RunStatusSchema.safeParse({ ...base, state: 'sleeping' }).success,
    ).toBe(false)
  })
})

describe('RunDetailSchema mission field', () => {
  const minimal = {
    id: 'x',
    source: {
      dem: { name: 'd', file: 'f', sha256: '', resolution_m: 80 },
      spice_kernels: [],
      window: {
        start: '2027-01-01T00:00:00+00:00',
        end: '2027-01-15T00:00:00+00:00',
        step_minutes: 30,
      },
      projection: 'p',
      plan_id: 'south_polar_dense',
    },
    config: {
      roi: { min_lat_deg: -90, max_lat_deg: -85 },
      grid_spacing_m: 500,
      coarse_spacing_m: 2000,
      refine_fraction: 0.25,
      min_separation_m: 2000,
      top_k: 100,
      thresholds: {
        min_sun_fraction: null,
        max_sun_dark_hours: 24,
        min_earth_fraction: null,
        max_earth_blackout_hours: 6,
      },
      weights: { sun: 0.5, earth: 0.5 },
      window: {
        start: '2027-01-01T00:00:00+00:00',
        end: '2027-01-15T00:00:00+00:00',
        step_minutes: 30,
      },
      dem: '80s_80m',
      observer_height_m: 0,
    },
    summary: { counts: {}, distributions: {}, warnings: [] },
    run: {
      generated_at: '2026-11-14T20:13:35+00:00',
      elapsed_seconds: 1,
      workers: 1,
    },
    map: {
      size_px: 3,
      center_px: 1,
      pixel_size_m: 500,
      rho_max_m: 500,
      layers: [],
    },
    candidates: [],
  }

  it('is nullable and defaults to null when the field is absent', () => {
    expect(RunDetailSchema.parse(minimal).mission).toBeNull()
    expect(
      RunDetailSchema.parse({ ...minimal, mission: null }).mission,
    ).toBeNull()
  })

  it('carries the mission when the run came from one', () => {
    expect(
      RunDetailSchema.parse({ ...minimal, mission: EXAMPLE }).mission,
    ).toEqual(EXAMPLE)
  })
})

describe('interpretStartResponse', () => {
  it('202 means a new search was started', () => {
    expect(
      interpretStartResponse(202, {
        run_id: 'm-abc',
        state: 'queued',
        cached: false,
      }),
    ).toEqual({
      kind: 'started',
      search: { run_id: 'm-abc', state: 'queued', cached: false },
    })
  })

  it('200 means an existing run: cached result or one that is already running', () => {
    const cached = interpretStartResponse(200, {
      run_id: 'm-abc',
      state: 'done',
      cached: true,
    })
    const running = interpretStartResponse(200, {
      run_id: 'm-abc',
      state: 'running',
      cached: false,
    })

    expect(cached.kind).toBe('existing')
    expect(cached.kind === 'existing' && cached.search.cached).toBe(true)
    expect(running.kind === 'existing' && running.search.state).toBe('running')
  })

  it('409 carries the id of the search that is already running', () => {
    expect(
      interpretStartResponse(409, {
        detail: {
          message: 'another search is running; try again when it finishes',
          running_run_id: 'm-other',
        },
      }),
    ).toEqual({
      kind: 'busy',
      message: 'another search is running; try again when it finishes',
      runningRunId: 'm-other',
    })
  })

  it('422 lists every server message in Korean where it knows the wording', () => {
    const outcome = interpretStartResponse(422, {
      detail: [
        {
          loc: ['body', 'mission_duration_days'],
          msg: 'Input should be greater than or equal to 1',
          type: 'greater_than_equal',
        },
        {
          loc: ['body'],
          msg: 'Value error, hybrid global search is planned and not available yet',
          type: 'value_error',
        },
        {
          loc: ['body'],
          msg: 'Value error, the mission must stay inside the ephemeris coverage (1850-2150)',
          type: 'value_error',
        },
      ],
    })

    expect(outcome.kind).toBe('invalid')
    if (outcome.kind !== 'invalid') return
    expect(outcome.messages).toHaveLength(3)
    expect(outcome.messages[0]).toContain('임무 기간')
    expect(outcome.messages[1]).toContain('계획 중')
    expect(outcome.messages[2]).toContain('1850')
  })

  it('422 with a plain string detail is shown as is', () => {
    expect(interpretStartResponse(422, { detail: 'bad input' })).toEqual({
      kind: 'invalid',
      messages: ['bad input'],
    })
  })

  it('other statuses are errors that keep the status code and detail', () => {
    let caught: unknown
    try {
      interpretStartResponse(500, { detail: 'could not start the search' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(500)
    expect((caught as ApiError).message).toContain('could not start')
  })

  it('a 202 with an unexpected body is an error, not a guess', () => {
    expect(() => interpretStartResponse(202, { hello: 'world' })).toThrow(
      /unexpected/,
    )
  })
})

describe('startSearch', () => {
  it('posts the exact request body as JSON to /candidates/search', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fetchFn = (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(
        json(202, { run_id: 'm-abc', state: 'queued', cached: false }),
      )
    }

    const outcome = await startSearch(EXAMPLE, { baseUrl: '/api', fetchFn })

    expect(outcome.kind).toBe('started')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/candidates/search')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(EXAMPLE)
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe(
      'application/json',
    )
  })

  it('maps a 409 to a busy outcome instead of throwing', async () => {
    const fetchFn = () =>
      Promise.resolve(
        json(409, {
          detail: { message: 'busy', running_run_id: 'm-other' },
        }),
      )

    await expect(
      startSearch(EXAMPLE, { baseUrl: '/api', fetchFn }),
    ).resolves.toMatchObject({ kind: 'busy', runningRunId: 'm-other' })
  })

  it('handles a non-JSON error body without crashing', async () => {
    const fetchFn = () =>
      Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }))

    await expect(
      startSearch(EXAMPLE, { baseUrl: '/api', fetchFn }),
    ).rejects.toMatchObject({ status: 502 })
  })
})

describe('fetchRunStatus', () => {
  it('reads /candidates/runs/{id}/status', async () => {
    const seen: string[] = []
    const fetchFn = (input: string) => {
      seen.push(input)
      return Promise.resolve(
        json(200, {
          run_id: 'm-abc',
          state: 'queued',
          stage: 'queued',
          done: 0,
          total: 0,
          error: null,
          started_at: null,
          updated_at: '2026-11-14T21:05:02+00:00',
        }),
      )
    }

    const status = await fetchRunStatus('m-abc', { baseUrl: '/api', fetchFn })

    expect(seen).toEqual(['/api/candidates/runs/m-abc/status'])
    expect(status.state).toBe('queued')
  })

  it('keeps the 404 status so the screen can tell that the run vanished', async () => {
    const fetchFn = () =>
      Promise.resolve(json(404, { detail: "run 'm-abc' not found" }))

    await expect(
      fetchRunStatus('m-abc', { baseUrl: '/api', fetchFn }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a malformed run id before making a request', () => {
    expect(() => fetchRunStatus('../x')).toThrow(/실행 ID/)
  })
})
