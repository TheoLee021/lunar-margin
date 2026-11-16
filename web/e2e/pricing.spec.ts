import { expect, test } from '@playwright/test'
import { providerCalendarFixture } from './provider-pricing-fixture.js'
import { z } from 'zod'
import { mockScheduledDepartures } from './launch-fixture.js'

test.beforeEach(async ({ page }) => {
  await mockScheduledDepartures(page)
})

test('missing landing dates launch one batch and display all five results', async ({
  page,
}) => {
  const completed = new Set<string>()
  const launched: string[] = []
  let batchCalls = 0
  let calendarPolls = 0
  await page.route('**/api/candidates/runs', (route) =>
    route.fulfill({ json: { runs: [] } }),
  )
  await page.route('**/api/pricing/providers/calendar', (route) => {
    if (launched.length && ++calendarPolls > 1)
      launched.forEach((date) => completed.add(date))
    return route.fulfill({
      json: providerCalendarFixture(route.request().postDataJSON(), (date) => ({
        run_id: `m-${date}`,
        state: completed.has(date)
          ? 'completed'
          : launched.length
            ? 'running'
            : 'not_computed',
        status: completed.has(date) ? 'quoted' : 'search_required',
        mean: completed.has(date) ? 29300000 : null,
        eligible: completed.has(date) ? 1 : null,
        priced: completed.has(date) ? 1 : 0,
      })),
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
  const calendarForSlope = (limit: number | null) =>
    page.waitForRequest(
      (request) =>
        request.url().endsWith('/pricing/providers/calendar') &&
        request.postDataJSON().mission.max_terrain_slope_degrees === limit,
    )
  const unrestricted = calendarForSlope(null)
  await page.goto('/explore?planner=1')
  await unrestricted
  const slope = page.getByLabel('최대 허용 경사', { exact: false })
  await expect(slope).toHaveValue('')
  const limited = calendarForSlope(12.5)
  await slope.fill('12.5')
  await limited
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('table').getByText('미계산').first(),
  ).toBeVisible()
  const starting = page.waitForRequest((request) =>
    request.url().endsWith('/pricing/calculate'),
  )
  await dialog.getByRole('button', { name: '미계산 날짜 탐색 · 500m' }).click()
  expect(
    (await starting).postDataJSON().mission.max_terrain_slope_degrees,
  ).toBe(12.5)
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
  await dialog.getByRole('button', { name: '일정 적용 ↗' }).click()
  await expect(page).toHaveURL(/max_slope=12\.5/)
  await page.reload()
  await page.getByRole('button', { name: '미션 날짜 비교 열기' }).click()
  await expect(page.getByLabel('최대 허용 경사', { exact: false })).toHaveValue(
    '12.5',
  )
})

test('date prices open the saved candidate run without recalculating', async ({
  page,
  request,
}) => {
  const fixtureResponse = await request.get(
    'http://localhost:8765/candidates/runs/synthetic',
  )
  expect(fixtureResponse.ok()).toBe(true)
  const fixture = await fixtureResponse.json()
  let recalculations = 0
  page.on('request', (req) => {
    if (
      req.method() === 'POST' &&
      /\/(candidates\/search|pricing\/calculate)/.test(req.url())
    )
      recalculations += 1
  })
  await page.route('**/api/candidates/runs/m-price-test', (route) =>
    route.fulfill({ json: { ...fixture, id: 'm-price-test' } }),
  )
  await page.route('**/api/candidates/runs/m-price-test/layers/**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(/^https?:\/\/[^/]+\/api/, 'http://localhost:8765')
        .replace('/m-price-test/', '/synthetic/'),
    }),
  )
  await page.route('**/api/candidates/runs', (route) =>
    route.fulfill({ json: { runs: [] } }),
  )
  await page.route('**/api/pricing/providers/calendar', async (route) => {
    const input = route.request().postDataJSON() as { mass_kg: number }
    if (input.mass_kg === 13)
      return route.fulfill({
        status: 503,
        json: { detail: 'Pricing unavailable' },
      })
    return route.fulfill({
      json: providerCalendarFixture(input, (date) => {
        const ready = date === '2027-01-10',
          empty = date === '2027-01-11'
        return {
          run_id: ready ? 'm-price-test' : `m-${date}`,
          state: ready || empty ? 'completed' : 'not_computed',
          status: ready ? 'quoted' : empty ? 'no_eligible' : 'search_required',
          mean: ready ? (input.mass_kg === 24 ? 31460000 : 62420000) : null,
          eligible: ready ? 2 : empty ? 0 : null,
          priced: ready ? 2 : 0,
        }
      }),
    })
  })
  await page.goto('/explore?planner=1')
  const dialog = page.getByRole('dialog')
  const grid = dialog.getByRole('table', {
    name: '출발일과 착륙일별 평균 가격',
  })
  const row = grid
    .locator('tbody tr')
    .filter({ has: page.getByRole('rowheader', { name: 'Jan 10' }) })
  await expect(row.locator('td').getByRole('link').first()).toContainText(
    '$31M',
  )
  await expect(row.locator('td').getByRole('link').nth(1)).toContainText('$31M')
  await expect(row.locator('td').getByRole('link').first()).toContainText(
    'Blue Origin',
  )
  await expect(grid.getByText('적합 격자 없음').first()).toBeVisible()
  await expect(grid.getByText('전이 3~150일').first()).toBeVisible()
  await expect(
    dialog.getByRole('region', { name: '평균 가격 계산 근거' }),
  ).toHaveCount(0)
  await dialog.getByLabel('화물 질량 · kg').fill('48')
  await expect(row.locator('td').getByRole('link').first()).toContainText(
    '$62M',
  )
  await dialog.getByLabel('화물 질량 · kg').fill('13')
  await expect(dialog.getByRole('alert')).toContainText('503')
  await expect(row.locator('td').getByRole('link')).toHaveCount(0)
  await dialog.getByLabel('화물 질량 · kg').fill('24')
  await expect(row.locator('td').getByRole('link').first()).toContainText(
    '$31M',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    dialog.getByRole('button', { name: '일정 적용 ↗' }),
  ).toBeVisible()
  await page.screenshot({ path: '/tmp/lunar-pricing-ready-mobile.png' })
  await dialog
    .getByRole('link', { name: 'Jan 10 · 착륙 2027-01-10 후보지 탐색 열기' })
    .click()
  await expect(page).toHaveURL(/view=search/)
  await expect(page).toHaveURL(/run=m-price-test/)
  await expect(page).toHaveURL(/departure=2027-01-06/)
  await expect(page).toHaveURL(/arrival=2027-01-10/)
  await expect(
    page.getByRole('combobox', { name: '탐색 실행', exact: true }),
  ).toHaveValue('m-price-test')
  await expect(page.getByRole('tab', { name: /1 \/ 6/ })).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('combobox', { name: '탐색 실행', exact: true }),
  ).toHaveValue('m-price-test')
  await expect(page.getByRole('tab', { name: /1 \/ 6/ })).toBeVisible()
  expect(recalculations).toBe(0)
  await page.goBack()
  await expect(dialog).toBeVisible()
  await row.locator('td').getByRole('link').first().click()
  await expect(page).toHaveURL(/departure=2027-01-04/)
  await expect(page).toHaveURL(/run=m-price-test/)
  await expect(page.getByRole('tab', { name: /1 \/ 6/ })).toBeVisible()
  expect(recalculations).toBe(0)
  await page.route('**/api/candidates/runs/m-price-test', (route) =>
    route.fulfill({ status: 404, json: { detail: 'search run not found' } }),
  )
  await page.reload()
  await expect(page.getByTestId('search-error')).toContainText('404')
  await expect(page.getByRole('tab', { name: /1 \/ 6/ })).toHaveCount(0)
  expect(recalculations).toBe(0)
})

test('candidate ranks show per-grid prices and recover from a price-only failure', async ({
  page,
  request,
}) => {
  const fixtureResponse = await request.get(
    'http://localhost:8765/candidates/runs/synthetic',
  )
  expect(fixtureResponse.ok()).toBe(true)
  const fixture = z
    .object({
      candidates: z
        .array(
          z.object({
            id: z.string(),
            rank: z.number(),
            x_m: z.number(),
            y_m: z.number(),
          }),
        )
        .min(3),
    })
    .parse(await fixtureResponse.json())
  const selected = [...fixture.candidates]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
  expect(selected).toHaveLength(3)
  await page.route('**/api/candidates/**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(/^https?:\/\/[^/]+\/api/, 'http://localhost:8765'),
    }),
  )
  let requests = 0
  let servePrices = false
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
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
  await page.route('**/api/pricing/runs/synthetic?**', async (route) => {
    requests++
    const query = new URL(route.request().url()).searchParams
    expect(query.get('mass_kg')).toBe('24')
    expect(query.get('delivery')).toBe('surface')
    expect(query.get('include_cells')).toBe('true')
    if (!servePrices) {
      await pending
      await route.fulfill({
        status: 503,
        json: { detail: 'temporary price failure' },
      })
      return
    }
    const cell = (index: number) => ({
      id: selected[index]!.id,
      x_m: selected[index]!.x_m,
      y_m: selected[index]!.y_m,
      landable_fraction: 1,
      aim_slope_deg: 0,
    })
    await route.fulfill({
      json: {
        run_id: 'synthetic',
        landing_date: '2027-01-10',
        mission_duration_days: 14,
        grid_spacing_m: 500,
        counts: {
          fine: 3,
          eligible: 2,
          priced: 1,
          terrain_excluded: 1,
          terrain_unknown: 0,
          unevaluated: 0,
          coarse_ignored: 0,
        },
        mean: price,
        // Reverse the price records: each amount must follow its grid ID, not its row index.
        cells: [
          {
            ...cell(1),
            price: null,
            excluded_reason: 'aim_point_slope_above_10_deg',
          },
          { ...cell(0), price, excluded_reason: null },
        ],
      },
    })
  })
  await page.goto('/?view=search&run=synthetic')
  const region = page.getByRole('region', { name: '후보 목록', exact: true })
  const row = (index: number) =>
    region.getByRole('row').filter({
      has: page.getByRole('button', {
        name: selected[index]!.id,
        exact: true,
      }),
    })
  await expect(
    region.getByRole('columnheader', { name: '가격 (USD)', exact: true }),
  ).toBeVisible()
  await expect(row(0)).toContainText('조회 중')
  release()
  await expect(row(0)).toContainText('조회 실패')
  const failedRequests = requests
  servePrices = true
  await region
    .getByRole('button', { name: '가격 다시 불러오기', exact: true })
    .click()
  await expect(row(0)).toContainText('$29M')
  await expect(row(1)).toContainText('산정 제외')
  await expect(row(2)).toContainText('미산정')
  await expect(region).toContainText('24 kg · 표면 하역')
  expect(requests).toBe(failedRequests + 1)
})

test('a busy search waits and automatically starts the missing dates when the worker is free', async ({
  page,
}) => {
  let released = false
  let batchCalls = 0
  let launched = false
  let statusCalls = 0
  await page.route('**/api/candidates/runs', (route) =>
    route.fulfill({ json: { runs: [] } }),
  )
  await page.route('**/api/pricing/providers/calendar', (route) =>
    route.fulfill({
      json: providerCalendarFixture(route.request().postDataJSON(), (date) => ({
        run_id: `m-${date}`,
        state: launched ? 'completed' : 'not_computed',
        status: launched ? 'quoted' : 'search_required',
        mean: launched ? 29300000 : null,
        eligible: launched ? 1 : null,
        priced: launched ? 1 : 0,
      })),
    }),
  )
  await page.route('**/api/candidates/runs/m-busy/status', (route) => {
    statusCalls++
    return route.fulfill({
      json: {
        run_id: 'm-busy',
        state: released ? 'done' : 'running',
        stage: 'fine',
        done: 2,
        total: 10,
        error: null,
        started_at: null,
        updated_at: '2026-11-15T09:00:00Z',
      },
    })
  })
  await page.route('**/api/pricing/calculate', (route) => {
    batchCalls++
    if (!released)
      return route.fulfill({
        status: 409,
        json: {
          detail: {
            message: 'another search is running',
            running_run_id: 'm-busy',
          },
        },
      })
    launched = true
    const input = route.request().postDataJSON() as { landing_dates: string[] }
    return route.fulfill({
      status: 202,
      json: {
        run_ids: input.landing_dates.map((date) => `m-${date}`),
        state: 'queued',
        cached: false,
      },
    })
  })
  await page.goto('/explore?planner=1')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '미계산 날짜 탐색 · 500m' }).click()
  await expect(
    dialog.getByRole('status').filter({ hasText: '다른 탐색이 진행 중' }),
  ).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(batchCalls).toBe(1)
  expect(statusCalls).toBeGreaterThan(0)
  released = true
  await expect(
    dialog.getByRole('table').getByText('$29M', { exact: true }),
  ).toHaveCount(19)
  expect(batchCalls).toBe(2)
  await expect(
    dialog.getByRole('status').filter({ hasText: '다른 탐색이 진행 중' }),
  ).toHaveCount(0)
})
