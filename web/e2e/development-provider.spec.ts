import { expect, test } from '@playwright/test'
import { z } from 'zod'
import { mockDashboardRuns } from './dashboard-fixture.js'

test('development candidates retain the independent company comparison', async ({
  page,
  request,
}) => {
  await page.route('**/api/**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(/^https?:\/\/[^/]+\/api/, 'http://localhost:8765'),
    }),
  )
  const [base] = await mockDashboardRuns(page, request)
  if (!base) throw new Error('Saved run fixture is missing')
  const run = {
    ...base,
    id: 'dev-v1-provider-comparison',
    config: { ...base.config, grid_spacing_m: 10000 },
    mission: {
      landing_date: '2027-01-10',
      mission_duration_days: 14,
      max_continuous_darkness_hours: null,
      max_communication_blackout_hours: null,
      max_terrain_slope_degrees: null,
      search_region: 'south',
      optimization_priority: 'balanced',
      observer_height_m: 0,
    },
  }
  await page.route(`**/api/candidates/runs/${run.id}`, (route) =>
    route.fulfill({ json: run }),
  )
  await page.route('**/api/pricing/providers/compare', (route) => {
    const input = z
      .looseObject({ source_run_id: z.string().optional() })
      .parse(route.request().postDataJSON())
    if (input.source_run_id)
      return route.fulfill({
        status: 409,
        json: {
          detail:
            '500m precision search required; development runs cannot be averaged',
        },
      })
    return route.fulfill({
      json: {
        ...input,
        catalog_checked_on: '2026-11-15',
        minimum_usd: null,
        minimum_estimate_usd: null,
        destination_multiplier: null,
        terrain_unknown: true,
        demand_multiplier: 1,
        demand_unknown: true,
        providers: [
          'blue_origin',
          'ispace_us',
          'spacex',
          'lockheed_martin',
          'northrop_grumman',
          'voyager',
        ].map((provider_id) => ({
          provider_id,
          name: provider_id,
          source: {
            title: 'Public provider information',
            url: 'https://example.com/provider',
            published_date: null,
          },
          issues: ['mission_unpublished'],
          flights: [],
          minimum_usd: null,
          minimum_estimate_usd: null,
        })),
      },
    })
  })
  await page.goto(`/?view=search&run=${run.id}`)
  const candidate = z.object({ id: z.string() }).parse(run.candidates[0])
  await page
    .getByRole('table')
    .getByRole('button', { name: candidate.id, exact: true })
    .click()
  const panel = page.getByRole('region', { name: '회사별 배송 비교' })
  await expect(panel).toContainText('독립 지점 가격 모델')
  await expect(panel.locator('article')).toHaveCount(6)
  await expect(panel.getByRole('alert')).toHaveCount(0)
})
