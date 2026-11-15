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
