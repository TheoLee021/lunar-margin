import { expect, test } from '@playwright/test'

test('missing landing dates launch one batch and display all five results', async ({
  page,
}) => {
  const completed = new Set<string>()
  const launched: string[] = []
  let batchCalls = 0
  let calendarPolls = 0
  const flat = {
    baseline_usd: 29_300_000,
    transport_usd: 28_800_000,
    destination_adjustment_usd: 0,
    demand_adjustment_usd: 0,
    fixed_usd: 500_000,
    adjusted_usd: 29_300_000,
    range_low_usd: 29_300_000,
    range_high_usd: 33_800_000,
    destination_multiplier: 1,
    demand_multiplier: 1,
    destination_unknown: false,
    demand_unknown: true,
    grade: 'modeled',
  }
  await page.route('**/api/candidates/runs', (route) =>
    route.fulfill({ json: { runs: [] } }),
  )
  await page.route('**/api/pricing/calendar', (route) => {
    if (launched.length && ++calendarPolls > 1)
      launched.forEach((date) => completed.add(date))
    const request = route.request().postDataJSON() as {
      landing_dates: string[]
    }
    return route.fulfill({
      json: {
        mass_kg: 24,
        delivery: 'surface',
        tariff_usd_per_kg: 1_200_000,
        evidence: [],
        dates: request.landing_dates.map((date) => ({
          landing_date: date,
          run_id: `m-${date}`,
          state: completed.has(date)
            ? 'ready'
            : launched.length
              ? 'running'
              : 'not_computed',
          message: null,
          pricing: completed.has(date)
            ? {
                run_id: `m-${date}`,
                landing_date: date,
                mission_duration_days: 14,
                grid_spacing_m: 500,
                counts: {
                  fine: 1,
                  eligible: 1,
                  priced: 1,
                  terrain_excluded: 0,
                  terrain_unknown: 0,
                  unevaluated: 0,
                  coarse_ignored: 0,
                },
                mean: flat,
                cells: [],
              }
            : null,
        })),
      },
    })
  })
  await page.route('**/api/pricing/calculate', (route) => {
    const request = route.request().postDataJSON() as {
      landing_dates: string[]
    }
    batchCalls += 1
    launched.push(...request.landing_dates)
    return route.fulfill({
      status: 202,
      json: {
        run_ids: request.landing_dates.map((date) => `m-${date}`),
        state: 'queued',
        cached: false,
      },
    })
  })
  await page.goto('/?planner=1')
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('table').getByText('미계산').first(),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '미계산 날짜 탐색 · 500m' }).click()
  await expect(
    dialog.getByRole('button', { name: '미계산 날짜 탐색 · 500m' }),
  ).toBeDisabled()
  expect(launched).toEqual([
    '2027-01-08',
    '2027-01-09',
    '2027-01-10',
    '2027-01-11',
    '2027-01-12',
  ])
  expect(batchCalls).toBe(1)
  await expect(dialog.getByRole('table').getByText('미계산')).toHaveCount(0)
})

test('date planner shows eligible-grid means and cargo changes', async ({
  page,
}) => {
  await page.route('**/api/candidates/runs', (route) =>
    route.fulfill({ json: { runs: [] } }),
  )
  const price = (kind: 'flat' | 'half' | 'mean', mass = 24) => {
    const values =
      mass === 24
        ? {
            flat: [29_300_000, 0],
            half: [33_620_000, 4_320_000],
            mean: [31_460_000, 2_160_000],
          }
        : {
            flat: [58_100_000, 0],
            half: [66_740_000, 8_640_000],
            mean: [62_420_000, 4_320_000],
          }
    const [adjusted, destination] = values[kind]!
    return {
      baseline_usd: mass === 24 ? 29_300_000 : 58_100_000,
      transport_usd: mass === 24 ? 28_800_000 : 57_600_000,
      destination_adjustment_usd: destination,
      demand_adjustment_usd: 0,
      fixed_usd: 500_000,
      adjusted_usd: adjusted,
      range_low_usd: adjusted,
      range_high_usd: adjusted! + 4_500_000,
      destination_multiplier:
        kind === 'flat' ? 1 : kind === 'half' ? 1.15 : 1.075,
      demand_multiplier: 1,
      destination_unknown: false,
      demand_unknown: true,
      grade: 'modeled',
    }
  }
  const counts = {
    fine: 5,
    eligible: 3,
    priced: 2,
    terrain_excluded: 1,
    terrain_unknown: 0,
    unevaluated: 0,
    coarse_ignored: 1,
  }
  await page.route('**/api/pricing/calendar', async (route) => {
    const request = route.request().postDataJSON() as {
      mass_kg: number
      delivery: string
      landing_dates: string[]
      mission: { mission_duration_days: number }
    }
    if (request.mass_kg === 13)
      return route.fulfill({
        status: 503,
        json: { detail: 'Pricing unavailable' },
      })
    await route.fulfill({
      json: {
        mass_kg: request.mass_kg,
        delivery: request.delivery,
        tariff_usd_per_kg: 1_200_000,
        evidence: [
          {
            term: 'F',
            value: '500000',
            grade: 'modeled',
            source: null,
            note: '고정비 근거 없음',
          },
        ],
        dates: request.landing_dates.map((date) => {
          const ready = date === '2027-01-10',
            empty = date === '2027-01-11'
          return {
            landing_date: date,
            run_id: 'm-price-test',
            state: ready ? 'ready' : empty ? 'no_eligible' : 'not_computed',
            message: null,
            pricing:
              ready || empty
                ? {
                    run_id: 'm-price-test',
                    landing_date: date,
                    mission_duration_days:
                      request.mission.mission_duration_days,
                    grid_spacing_m: 500,
                    counts: ready
                      ? counts
                      : {
                          ...counts,
                          eligible: 0,
                          priced: 0,
                          terrain_excluded: 0,
                        },
                    mean: ready ? price('mean', request.mass_kg) : null,
                    cells: [],
                  }
                : null,
          }
        }),
      },
    })
  })
  await page.goto('/?planner=1')
  const dialog = page.getByRole('dialog')
  const grid = dialog.getByRole('table', {
    name: '출발일과 착륙일별 평균 가격',
  })
  const row = grid
    .locator('tbody tr')
    .filter({ has: page.getByRole('rowheader', { name: 'Jan 10' }) })
  await expect(row.getByRole('button').first()).toContainText('$31M')
  await expect(row.getByRole('button').nth(1)).toContainText('$31M')
  await expect(row.getByRole('button').first()).toContainText('2개 격자 평균')
  await expect(grid.getByText('적합 격자 없음').first()).toBeVisible()
  await expect(grid.getByText('전이 3~150일').first()).toBeVisible()
  await expect(
    dialog.getByRole('region', { name: '평균 가격 계산 근거' }),
  ).toHaveCount(0)
  await dialog.getByLabel('화물 질량 · kg').fill('48')
  await expect(row.getByRole('button').first()).toContainText('$62M')
  await dialog.getByLabel('화물 질량 · kg').fill('13')
  await expect(dialog.getByRole('alert')).toContainText('503')
  await expect(row.getByRole('button').first()).not.toContainText('$62M')
  await dialog.getByLabel('화물 질량 · kg').fill('24')
  await expect(row.getByRole('button').first()).toContainText('$31M')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    dialog.getByRole('button', { name: '일정 적용 ↗' }),
  ).toBeVisible()
  await page.screenshot({ path: '/tmp/lunar-pricing-ready-mobile.png' })
})
