import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { z } from 'zod'

const FixtureSchema = z.looseObject({
  source: z.looseObject({}),
  config: z.looseObject({ dem: z.string() }),
  candidates: z.array(z.record(z.string(), z.unknown())).min(1),
  run: z.looseObject({ generated_at: z.string() }),
})

/** Saved API results at known coordinates, independent of the dashboard's old fixtures. */
export async function mockDashboardRuns(
  page: Page,
  request: APIRequestContext,
) {
  const response = await request.get(
    'http://localhost:8765/candidates/runs/synthetic',
  )
  expect(response.ok()).toBe(true)
  const base = FixtureSchema.parse(await response.json())
  const windows = [
    {
      start: '2027-01-10T00:00:00Z',
      end: '2027-01-24T00:00:00Z',
      step_minutes: 30,
    },
    {
      start: '2027-01-11T00:00:00Z',
      end: '2027-01-18T00:00:00Z',
      step_minutes: 30,
    },
  ]
  const coordinates = [
    [-89.71, 37.5],
    [-89.02, -94.4],
    [-85.44, -115],
    [-87.99, -166.5],
    [-88.47, -67.7],
    [-88.8, 45],
  ]
  const runs = windows.map((window, index) => ({
    ...base,
    id: `saved-dashboard-${index}`,
    mission: null,
    source: { ...base.source, window },
    config: {
      ...base.config,
      grid_spacing_m: 500,
      window,
      observer_height_m: index ? 6 : 0,
    },
    candidates: coordinates.map(([lat_deg, lon_deg], rank) => ({
      ...base.candidates[rank % base.candidates.length]!,
      id: `saved-${index}-${rank + 1}`,
      rank: rank + 1,
      lat_deg: lat_deg!,
      lon_deg: lon_deg!,
    })),
  }))
  await page.route('**/api/candidates/runs', (route) =>
    route.fulfill({
      json: {
        runs: runs.map((run) => ({
          id: run.id,
          generated_at: run.run.generated_at,
          dem: run.config.dem,
          window: run.config.window,
          selected: run.candidates.length,
          sampled_total: 100,
        })),
      },
    }),
  )
  for (const run of runs)
    await page.route(`**/api/candidates/runs/${run.id}`, (route) =>
      route.fulfill({ json: run }),
    )
  return runs
}
