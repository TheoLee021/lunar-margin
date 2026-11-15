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

it('requires selected-company metadata and rejects a calendar for a different launch', async () => {
  const { fetchProviderCalendar } = await import('./providerPricing')
  const response = {
    estimate: true,
    selection: {
      launch_id: 'ula-demo',
      launch_name: 'Amazon Leo',
      company_id: null,
      company_name: 'United Launch Alliance (ULA)',
      tariff_usd_per_kg: 1200000,
      fixed_usd: 500000,
      billable_mass_kg: 24,
      tariff_basis: 'common_model',
      tariff_source: {
        title: 'Common reference',
        url: 'https://example.com/',
        published_date: null,
      },
      assumptions: ['Demo only'],
    },
    catalog_checked_on: '2026-11-15',
    mass_kg: 24,
    delivery: 'surface',
    mission_duration_days: 14,
    aggregation: 'mean_of_grid_minima',
    sampling: 'all_eligible_500m_grids',
    dates: [
      {
        landing_date: '2027-01-10',
        run_id: 'saved',
        state: 'completed',
        message: null,
      },
    ],
    cells: [
      {
        departure_date: '2027-01-06',
        landing_date: '2027-01-10',
        run_id: 'saved',
        status: 'estimated',
        mean_min_usd: 29300000,
        eligible_grid_count: 110,
        quoted_grid_count: 110,
        eligible_provider_ids: [],
      },
    ],
  }
  expect(ProviderCalendarSchema.safeParse(response).success).toBe(true)
  expect(
    ProviderCalendarSchema.safeParse({ ...response, selection: null }).success,
  ).toBe(false)
  expect(
    ProviderCalendarSchema.safeParse({ ...response, estimate: false }).success,
  ).toBe(false)
  const attributed = {
    ...response,
    selection: null,
    cells: response.cells.map((c) => ({
      ...c,
      lowest_company_names: ['United Launch Alliance (ULA)'],
      lowest_launch_id: 'ula-demo',
    })),
  }
  expect(ProviderCalendarSchema.safeParse(attributed).success).toBe(true)
  expect(
    ProviderCalendarSchema.safeParse({
      ...attributed,
      cells: attributed.cells.map((c) => ({ ...c, lowest_company_names: [] })),
    }).success,
  ).toBe(false)
  expect(
    ProviderCalendarSchema.safeParse({
      ...attributed,
      cells: attributed.cells.map((c) => ({
        ...c,
        mean_min_usd: null,
        status: 'no_launch',
      })),
    }).success,
  ).toBe(false)
  const input = {
    estimate: true,
    selected_launch_id: 'spacex-demo',
    mass_kg: 24,
    delivery: 'surface' as const,
    departure_dates: ['2027-01-06'],
    landing_dates: ['2027-01-10'],
    mission: {
      landing_date: '2027-01-10',
      mission_duration_days: 14,
      max_continuous_darkness_hours: 24,
      max_communication_blackout_hours: 6,
      max_terrain_slope_degrees: null,
      search_region: 'south' as const,
      optimization_priority: 'balanced' as const,
      observer_height_m: null,
    },
  }
  const options = { fetchFn: async () => Response.json(response) }
  await expect(fetchProviderCalendar(input, options)).rejects.toThrow(
    '요청과 일치',
  )
  const valid = await fetchProviderCalendar(
    { ...input, selected_launch_id: 'ula-demo' },
    options,
  )
  expect(valid.cells[0]!.mean_min_usd).toBe(29300000)
})
