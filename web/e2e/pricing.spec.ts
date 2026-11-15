import { expect, test } from '@playwright/test'
import { providerCalendarFixture } from './provider-pricing-fixture.js'

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
  await page.goto('/?planner=1')
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
    '2개 격자 최저가 평균',
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
