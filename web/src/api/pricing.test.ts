import { expect, test } from 'vitest'
import {
  formatPrice,
  isTransitPossible,
  fetchCalendar,
  fetchGridPrices,
} from './pricing'

test('prices display two significant digits and transit is only an eligibility gate', () => {
  expect(formatPrice(37_248_800)).toBe('$37M')
  expect(formatPrice(9_580_000)).toBe('$9.6M')
  expect(isTransitPossible('2027-01-01', '2027-01-03')).toBe(false)
  expect(isTransitPossible('2027-01-01', '2027-01-04')).toBe(true)
  expect(isTransitPossible('2027-01-01', '2027-05-31')).toBe(true)
  expect(isTransitPossible('2027-01-01', '2027-06-01')).toBe(false)
})

test('calendar refuses a response for a different cargo or dates', async () => {
  await expect(
    fetchCalendar(
      {
        mission: {
          landing_date: '2027-01-10',
          mission_duration_days: 14,
          max_continuous_darkness_hours: 24,
          max_communication_blackout_hours: 6,
          max_terrain_slope_degrees: null,
          observer_height_m: null,
          search_region: 'south',
          optimization_priority: 'balanced',
        },
        landing_dates: ['2027-01-10'],
        mass_kg: 24,
        delivery: 'surface',
      },
      {
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              mass_kg: 99,
              delivery: 'surface',
              tariff_usd_per_kg: 1_200_000,
              dates: [],
              evidence: [],
            }),
            { status: 200 },
          ),
      },
    ),
  ).rejects.toThrow()
})

test('grid prices reject a response for a different candidate run', async () => {
  await expect(
    fetchGridPrices('m-requested', 24, 'surface', {
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            run_id: 'm-other',
            landing_date: '2027-01-09',
            mission_duration_days: 14,
            grid_spacing_m: 500,
            counts: {
              fine: 0,
              eligible: 0,
              priced: 0,
              terrain_excluded: 0,
              terrain_unknown: 0,
              unevaluated: 0,
              coarse_ignored: 0,
            },
            mean: null,
            cells: [],
          }),
          { status: 200 },
        ),
    }),
  ).rejects.toThrow('탐색 실행')
})

test('a busy calendar waits for the unrelated run and retries the original batch', async () => {
  const { startCalendar } = await import('./pricing')
  const input = {
    mission: {
      landing_date: '2027-01-10',
      mission_duration_days: 14,
      max_continuous_darkness_hours: 24,
      max_communication_blackout_hours: 6,
      max_terrain_slope_degrees: null,
      observer_height_m: null,
      search_region: 'south' as const,
      optimization_priority: 'balanced' as const,
    },
    landing_dates: ['2027-01-10', '2027-01-11'],
    mass_kg: 24,
    delivery: 'surface' as const,
  }
  let requested = false
  const bodies: unknown[] = []
  const result = await startCalendar(input, {
    fetchFn: async (url, init) => {
      if (url.endsWith('/m-busy/status'))
        return Response.json({
          run_id: 'm-busy',
          state: 'done',
          stage: 'done',
          done: 10,
          total: 10,
          error: null,
          started_at: null,
          updated_at: '2026-11-15T09:00:00Z',
        })
      bodies.push(JSON.parse(String(init?.body)))
      if (!requested) {
        requested = true
        return Response.json(
          {
            detail: {
              message: 'another search is running',
              running_run_id: 'm-busy',
            },
          },
          { status: 409 },
        )
      }
      return Response.json(
        { run_ids: ['m-jan10', 'm-jan11'], state: 'queued', cached: false },
        { status: 202 },
      )
    },
  })
  expect(result.run_ids).toEqual(['m-jan10', 'm-jan11'])
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
})

test('aborting a busy calendar never starts another batch', async () => {
  const { startCalendar } = await import('./pricing')
  const controller = new AbortController()
  let submissions = 0
  await expect(
    startCalendar(
      {
        mission: {
          landing_date: '2027-01-10',
          mission_duration_days: 14,
          max_continuous_darkness_hours: 24,
          max_communication_blackout_hours: 6,
          max_terrain_slope_degrees: null,
          observer_height_m: null,
          search_region: 'south',
          optimization_priority: 'balanced',
        },
        landing_dates: ['2027-01-10'],
        mass_kg: 24,
        delivery: 'surface',
      },
      {
        signal: controller.signal,
        onBusy: (status) => {
          if (status) controller.abort()
        },
        fetchFn: async (url) => {
          if (url.endsWith('/m-busy/status'))
            return Response.json({
              run_id: 'm-busy',
              state: 'running',
              stage: 'fine',
              done: 2,
              total: 10,
              error: null,
              started_at: null,
              updated_at: '2026-11-15T09:00:00Z',
            })
          submissions++
          return Response.json(
            {
              detail: {
                message: 'another search is running',
                running_run_id: 'm-busy',
              },
            },
            { status: 409 },
          )
        },
      },
    ),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(submissions).toBe(1)
})

test('preserves the shared search slope policy on price responses', async () => {
  const policy = {
    basis: 'saved_search_eligibility',
    max_slope_degrees: 15,
    statistic: 'p95',
    assessment_radius_m: 250,
    slope_baseline_m: 160,
  }
  const result = await fetchGridPrices('same-run', 24, 'surface', {
    baseUrl: '',
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          run_id: 'same-run',
          landing_date: '2027-01-10',
          mission_duration_days: 14,
          grid_spacing_m: 500,
          slope_policy: policy,
          mean: null,
          cells: [],
          counts: {
            fine: 0,
            eligible: 0,
            priced: 0,
            terrain_excluded: 0,
            terrain_unknown: 0,
            unevaluated: 0,
            coarse_ignored: 0,
          },
        }),
      ),
  })
  expect(result).toHaveProperty('slope_policy', policy)
})
