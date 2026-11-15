import { expect, test } from '@playwright/test'
import { z } from 'zod'
import { mockDashboardRuns } from './dashboard-fixture.js'

test('price exclusions show their reason inline and shared search slope policy is visible', async ({
  page,
  request,
}) => {
  const [run] = await mockDashboardRuns(page, request)
  if (!run) throw new Error('Saved run fixture is missing')
  await page.route(`**/api/candidates/runs/${run.id}`, (route) =>
    route.fulfill({
      json: {
        ...run,
        mission: {
          landing_date: '2027-01-10',
          mission_duration_days: 14,
          max_continuous_darkness_hours: null,
          max_communication_blackout_hours: null,
          max_terrain_slope_degrees: 15,
          max_terrain_roughness_m: null,
          search_region: 'south',
          optimization_priority: 'balanced',
          observer_height_m: 0,
        },
      },
    }),
  )
  const selected = run.candidates
    .slice(0, 2)
    .map((c) =>
      z.object({ id: z.string(), x_m: z.number(), y_m: z.number() }).parse(c),
    )
  let shared = false
  const price = {
    baseline_usd: 29300000,
    transport_usd: 28800000,
    destination_adjustment_usd: 0,
    demand_adjustment_usd: 0,
    fixed_usd: 500000,
    adjusted_usd: 29300000,
    range_low_usd: 29300000,
    range_high_usd: 33800000,
    destination_multiplier: 1,
    demand_multiplier: 1,
    destination_unknown: false,
    demand_unknown: true,
    grade: 'modeled',
  }
  await page.route('**/api/pricing/runs/*?**', (route) =>
    route.fulfill({
      json: {
        run_id: run.id,
        landing_date: '2027-01-10',
        mission_duration_days: 14,
        grid_spacing_m: 500,
        ...(shared
          ? {
              slope_policy: {
                basis: 'saved_search_eligibility',
                max_slope_degrees: 15,
                statistic: 'p95',
                assessment_radius_m: 250,
                slope_baseline_m: 160,
              },
            }
          : {}),
        counts: {
          fine: 2,
          eligible: 2,
          priced: shared ? 2 : 0,
          terrain_excluded: shared ? 0 : 2,
          terrain_unknown: 0,
          unevaluated: 0,
          coarse_ignored: 0,
        },
        mean: shared ? price : null,
        cells: selected.map((c, index) => ({
          id: c.id,
          x_m: c.x_m,
          y_m: c.y_m,
          aim_slope_deg: index ? null : 10.0693475778,
          landable_fraction: index ? 0.025 : 0.28,
          price: shared ? price : null,
          excluded_reason: shared
            ? null
            : index
              ? 'landable_fraction_below_0.05'
              : 'aim_point_slope_above_10_deg',
        })),
      },
    }),
  )
  await page.goto(`/?view=search&run=${run.id}`)
  const table = page.getByRole('table')
  await expect(table).toContainText('중심 경사 10.07° > 기존 가격 한도 10°')
  await expect(table).toContainText('저경사 면적 비율 2.5% < 기존 가격 한도 5%')
  await table.screenshot({ path: 'test-results/price-exclusion-reasons.png' })
  shared = true
  await page.reload()
  await expect(table).toContainText('가격 경사 판정: 검색과 동일')
  await expect(table).toContainText('250 m 지역 경사 P95 ≤ 15°')
  await expect(table).not.toContainText('산정 제외')
  const comparison = page.waitForRequest((req) =>
    req.url().includes('/pricing/providers/compare'),
  )
  await table
    .getByRole('button', { name: String(selected[0]!.id), exact: true })
    .click()
  expect((await comparison).postDataJSON()).toHaveProperty(
    'source_run_id',
    run.id,
  )
})
