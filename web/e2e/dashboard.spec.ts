import { expect, test } from '@playwright/test'
import { mockScheduledDepartures } from './launch-fixture.js'
import { mockDashboardRuns } from './dashboard-fixture.js'

test('dashboard uses the date’s saved top five and analyzes only the selected candidate', async ({
  page,
  request,
}) => {
  await mockScheduledDepartures(page)
  const runs = await mockDashboardRuns(page, request)
  runs[0]!.candidates.reverse()
  const analysisRequests: URL[] = []
  let searches = 0
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (
      ['/api/analysis/earth-visibility', '/api/analysis/illumination'].includes(
        url.pathname,
      )
    ) {
      const start = Date.parse(url.searchParams.get('start') ?? '')
      const end = Date.parse(url.searchParams.get('end') ?? '')
      // Candidate analysis covers the mission; equipment requests sample one instant.
      if (end - start > 30 * 60_000) analysisRequests.push(url)
    }
    if (
      req.method() === 'POST' &&
      /\/(candidates\/search|pricing\/calculate)/.test(req.url())
    )
      searches++
  })
  await page.route('**/api/analysis/**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(/^https?:\/\/[^/]+\/api/, 'http://localhost:8765'),
    }),
  )
  await page.goto('/explore')
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  const metrics = page.getByRole('complementary', { name: '선택한 지점' })
  await expect(
    rail.getByRole('heading', { name: 'TOP 5 후보', exact: true }),
  ).toBeVisible()
  await expect(rail.locator('ol button')).toHaveCount(5)
  await expect(rail.locator('ol button').first()).toContainText('후보 1')
  await expect(rail.getByRole('button', { name: /후보 6/ })).toHaveCount(0)
  await expect(metrics).toHaveCount(0)
  expect(analysisRequests).toHaveLength(0)
  await rail.getByRole('button', { name: /후보 1/ }).click()
  const timeline = metrics.getByRole('region', { name: '미션 기간 타임라인' })
  await expect(timeline.getByRole('img')).toBeVisible()
  await expect(metrics).toContainText('89.7100°S 37.5000°E')
  expect(analysisRequests.at(-1)!.searchParams.get('lat')).toBe('-89.71')
  await expect(page).toHaveURL(/site=saved-0-1/)
  await rail.getByRole('button', { name: /후보 2/ }).click()
  await expect(timeline.getByRole('img')).toBeVisible()
  await expect(metrics).toContainText('89.0200°S 94.4000°W')
  expect(analysisRequests.at(-1)!.searchParams.get('lat')).toBe('-89.02')
  const beforeDates = analysisRequests.length
  await page.getByRole('button', { name: '미션 날짜 비교 열기' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('기준 착륙일 · UTC', { exact: true })
    .fill('2027-01-11')
  await dialog
    .getByRole('combobox', { name: /착륙 후 표면 임무/ })
    .selectOption('7')
  await dialog.getByRole('button', { name: '일정 적용 ↗' }).click()
  await expect(rail).toContainText('2027-01-11 · 7일')
  await expect(metrics).toHaveCount(0)
  await expect(rail.locator('ol button')).toHaveCount(5)
  expect(analysisRequests).toHaveLength(beforeDates)
  await rail.getByRole('button', { name: /후보 1/ }).click()
  await expect(timeline.getByRole('img')).toBeVisible()
  expect(analysisRequests.at(-1)!.searchParams.get('observer_height_m')).toBe(
    '6',
  )
  expect(analysisRequests.at(-1)!.searchParams.get('start')).toBe(
    '2027-01-11T00:00:00Z',
  )
  await expect(timeline).toContainText('관측 높이 6 m')
  expect(searches).toBe(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(timeline.getByRole('img')).toBeVisible()
  await metrics.getByRole('button', { name: '후보 선택 해제' }).click()
  await expect(metrics).toHaveCount(0)
  await expect(rail).toBeVisible()
})

test('dashboard has no example fallback for missing or failed saved results', async ({
  page,
  request,
}) => {
  const runs = await mockDashboardRuns(page, request)
  let mode: 'empty' | 'ready' | 'error' = 'empty'
  await page.route('**/api/candidates/runs', (route) =>
    mode === 'ready'
      ? route.fallback()
      : mode === 'empty'
        ? route.fulfill({ json: { runs: [] } })
        : route.fulfill({
            status: 503,
            json: { detail: 'Saved runs unavailable' },
          }),
  )
  await page.route('**/api/analysis/**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(/^https?:\/\/[^/]+\/api/, 'http://localhost:8765'),
    }),
  )
  await page.goto('/explore?site=site-1')
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  const metrics = page.getByRole('complementary', { name: '선택한 지점' })
  await expect(rail).toContainText('저장된 탐색 결과가 없습니다')
  await expect(rail.locator('ol button')).toHaveCount(0)
  await expect(metrics).toHaveCount(0)
  mode = 'ready'
  await rail.getByRole('button', { name: '결과 새로고침' }).click()
  await expect(rail.locator('ol button')).toHaveCount(5)
  await rail.getByRole('button', { name: /후보 1/ }).click()
  await expect(metrics.getByRole('img')).toBeVisible()
  mode = 'error'
  await rail.getByRole('button', { name: '결과 새로고침' }).click()
  await expect(rail.getByRole('alert')).toContainText('503')
  await expect(rail.locator('ol button')).toHaveCount(0)
  await expect(metrics).toHaveCount(0)
  mode = 'ready'
  runs[0]!.candidates = []
  await rail.getByRole('button', { name: '결과 새로고침' }).click()
  await expect(rail).toContainText('이 탐색에서 선정된 후보가 없습니다')
  await expect(rail.locator('ol button')).toHaveCount(0)
  await expect(metrics).toHaveCount(0)
})
