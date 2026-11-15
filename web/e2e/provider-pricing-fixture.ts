import { z } from 'zod'

const Input = z.object({
  mass_kg: z.number(),
  delivery: z.string(),
  landing_dates: z.array(z.string()),
  departure_dates: z.array(z.string()),
  mission: z.object({ mission_duration_days: z.number() }),
})
type Row = {
  run_id: string
  state: 'completed' | 'not_computed' | 'running'
  status: 'quoted' | 'search_required' | 'no_eligible' | 'no_published_quote'
  mean: number | null
  eligible: number | null
  priced: number
}
/** Synthetic published-offer results for UI behavior; these are not real company quotes. */
export function providerCalendarFixture(
  body: unknown,
  row: (landing: string) => Row,
) {
  const input = Input.parse(body)
  return {
    catalog_checked_on: '2026-11-15',
    mass_kg: input.mass_kg,
    delivery: input.delivery,
    mission_duration_days: input.mission.mission_duration_days,
    aggregation: 'mean_of_grid_minima',
    sampling: 'all_eligible_500m_grids',
    dates: input.landing_dates.map((landing) => ({
      landing_date: landing,
      run_id: row(landing).run_id,
      state: row(landing).state,
      message: null,
    })),
    cells: input.landing_dates.flatMap((landing) =>
      input.departure_dates.map((departure) => {
        const r = row(landing)
        return {
          departure_date: departure,
          landing_date: landing,
          run_id: r.run_id,
          status: r.status,
          mean_min_usd: r.mean,
          lowest_company_names: r.mean !== null ? ['Blue Origin'] : [],
          lowest_launch_id: null,
          eligible_grid_count: r.eligible,
          quoted_grid_count: r.priced,
          eligible_provider_ids: r.status === 'quoted' ? ['blue_origin'] : [],
        }
      }),
    ),
  }
}
