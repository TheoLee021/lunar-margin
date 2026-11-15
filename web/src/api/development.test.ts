import { expect, it } from 'vitest'
import { RunStatusSchema, startSearch, type MissionRequest } from './candidates'

it('uses the development endpoint only when explicitly requested', async () => {
  const calls: string[] = []
  const request: MissionRequest = {
    landing_date: '2027-01-01',
    mission_duration_days: 14,
    max_continuous_darkness_hours: 216,
    max_communication_blackout_hours: 216,
    max_terrain_slope_degrees: null,
    search_region: 'south',
    optimization_priority: 'balanced',
    observer_height_m: null,
  }
  const fetchFn: typeof fetch = async (input) => {
    calls.push(String(input))
    return new Response(
      JSON.stringify({ run_id: 'dev-test', state: 'queued', cached: false }),
      { status: 202 },
    )
  }
  await startSearch(request, { fetchFn, development: true })
  await startSearch(request, { fetchFn })
  expect(calls).toEqual([
    '/api/candidates/search/dev',
    '/api/candidates/search',
  ])
})

it('preserves terminal timing and supports legacy status responses', () => {
  const status = {
    run_id: 'test',
    state: 'done',
    stage: 'done',
    done: 1,
    total: 1,
    error: null,
    started_at: null,
    updated_at: '2026-11-14T00:00:00Z',
  }
  expect(
    RunStatusSchema.parse({
      ...status,
      elapsed_seconds: 12.5,
      completed_at: '2026-11-14T00:00:13Z',
    }),
  ).toMatchObject({
    elapsed_seconds: 12.5,
    completed_at: '2026-11-14T00:00:13Z',
  })
  expect(RunStatusSchema.parse(status).elapsed_seconds).toBeNull()
})
