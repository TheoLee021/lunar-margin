import { expect, it } from 'vitest'
import { ProviderCalendarSchema } from './providerPricing'

it('never parses unknown company prices as a zero-dollar minimum', () => {
  const response = {
    catalog_checked_on: '2026-11-15',
    mass_kg: 24,
    delivery: 'surface',
    mission_duration_days: 14,
    aggregation: 'mean_of_grid_minima',
    sampling: 'all_eligible_500m_grids',
    dates: [
      {
        landing_date: '2027-01-10',
        run_id: 'm-example',
        state: 'completed',
        message: null,
      },
    ],
    cells: [
      {
        departure_date: '2027-01-06',
        landing_date: '2027-01-10',
        run_id: 'm-example',
        status: 'no_published_quote',
        mean_min_usd: null,
        eligible_grid_count: null,
        quoted_grid_count: 0,
        eligible_provider_ids: [],
      },
    ],
  }
  expect(
    ProviderCalendarSchema.parse(response).cells[0]!.mean_min_usd,
  ).toBeNull()
  expect(
    ProviderCalendarSchema.safeParse({
      ...response,
      cells: [{ ...response.cells[0], mean_min_usd: 0 }],
    }).success,
  ).toBe(false)
  expect(
    ProviderCalendarSchema.safeParse({
      ...response,
      cells: [
        {
          ...response.cells[0],
          status: 'quoted',
          mean_min_usd: 10,
          eligible_grid_count: 110,
          quoted_grid_count: 100,
        },
      ],
    }).success,
  ).toBe(false)
})
