import { expect, test } from '@playwright/test'

type Analysis = {
  metrics: { visible_fraction: number; longest_dark_hours: number }
  series: { body_elevation_deg: number[]; visible: boolean[] }
}

test('mission planner previews dates, discards drafts and applies the selection', async ({
  page,
  request,
}) => {
  const query =
    'lat=-89.02&lon=-94.4&start=2027-01-10T00:00:00Z&end=2027-01-24T00:00:00Z&step_minutes=30&observer_height_m=0'
  const sunResponse = await request.get(`/api/analysis/illumination?${query}`)
  const earthResponse = await request.get(
    `/api/analysis/earth-visibility?${query}`,
  )
  expect(sunResponse.ok()).toBe(true)
  expect(earthResponse.ok()).toBe(true)
  const sun: Analysis = await sunResponse.json()
  const earth: Analysis = await earthResponse.json()
  const degree = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°`
  await page.goto('/')
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 30_000 },
  )
  await expect(page.locator('.cesium-widget canvas')).toHaveCount(1)
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  await rail.getByRole('button', { name: /후보 2/ }).click()
  await expect(rail.getByRole('button', { name: /후보 2/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  const metrics = page.getByRole('complementary', { name: '선택한 지점' })
  const metric = (label: string) =>
    metrics
      .locator('dl > div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator('dd')
  await expect(metric('일조율')).toHaveText(
    `${(sun.metrics.visible_fraction * 100).toFixed(1)}%`,
  )
  await expect(metric('지구 가시율')).toHaveText(
    `${(earth.metrics.visible_fraction * 100).toFixed(1)}%`,
  )
  await expect(metric('최장 연속 어둠')).toHaveText(
    `${sun.metrics.longest_dark_hours.toFixed(1)} 시간`,
  )
  await expect(metric('최장 지구 차폐')).toHaveText(
    `${earth.metrics.longest_dark_hours.toFixed(1)} 시간`,
  )
  await page.getByRole('button', { name: '선택 지점 3D로 보기' }).click()
  await page.getByRole('button', { name: '위에서 보기' }).click()
  const slope = page.getByRole('slider', { name: /경사 ≤/ })
  await slope.fill('0')
  await expect(
    rail.getByText('조건을 만족하는 예시 후보가 없습니다. 필터를 완화하세요.'),
  ).toBeVisible()
  await slope.fill('12')
  await expect(rail.getByRole('button', { name: /후보 2/ })).toBeVisible()

  const opener = page.getByRole('button', { name: '미션 날짜 비교 열기' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: '미션 날짜 UTC' })
  await expect(dialog).toBeVisible()

  await dialog
    .getByLabel('기준 출발일 · UTC', { exact: true })
    .fill('2026-10-13')
  await dialog
    .getByLabel('기준 착륙일 · UTC', { exact: true })
    .fill('2026-10-22')
  await expect(dialog.locator('.planner-footer [aria-live]')).toHaveText(
    'Oct 13 → Oct 22',
  )
  await expect(dialog.locator('.transfer-stats')).toContainText('2026.10.13')
  await expect(dialog.locator('.transfer-stats')).toContainText('2026.10.22')
  await dialog
    .getByLabel('기준 출발일 · UTC', { exact: true })
    .fill('2027-01-06')
  await dialog
    .getByLabel('기준 착륙일 · UTC', { exact: true })
    .fill('2027-01-10')
  const grid = dialog.getByRole('table', {
    name: '출발일과 착륙일별 예시 비용',
  })
  await expect(grid.locator('tbody tr')).toHaveCount(5)
  await expect(grid.locator('thead th')).toHaveCount(6)
  await expect(grid.locator('thead')).toContainText('Jan 04')
  await expect(grid.locator('thead')).toContainText('Jan 08')

  const timeline = dialog.getByRole('region', { name: '미션 기간 타임라인' })
  await expect(
    timeline.getByRole('img', {
      name: '고도각과 햇빛·지구 가시성을 함께 표시하는 타임라인',
    }),
  ).toBeVisible()
  await timeline.getByRole('slider', { name: '타임라인 검토 시점' }).fill('1')
  await expect(timeline.locator('output')).toHaveText(
    'D+0 00:30 · 2027-01-10 00:30 UTC',
  )
  await expect(
    timeline.getByText(
      `태양 ${degree(sun.series.body_elevation_deg[1]!)} · ${sun.series.visible[1] ? '햇빛 있음' : '햇빛 없음'}`,
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    timeline.getByText(
      `지구 ${degree(earth.series.body_elevation_deg[1]!)} · ${earth.series.visible[1] ? '지구 가시' : '지구 차폐'}`,
      { exact: true },
    ),
  ).toBeVisible()
  const combination = dialog.getByRole('button', {
    name: /출발 2027-01-07, 착륙 2027-01-11,/,
  })
  await combination.click()
  await expect(combination).toHaveAttribute('aria-pressed', 'true')
  await dialog
    .getByRole('combobox', { name: /착륙 후 표면 임무/ })
    .selectOption('7')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(opener).toContainText('2027.01.06')
  await expect(opener).toContainText('14일')
  await expect(opener).toBeFocused()

  await opener.click()
  await dialog
    .getByRole('button', { name: /출발 2027-01-07, 착륙 2027-01-11,/ })
    .click()
  await dialog
    .getByRole('combobox', { name: /착륙 후 표면 임무/ })
    .selectOption('7')
  await expect(
    timeline.getByText('2027-01-11 → 2027-01-18 UTC', { exact: false }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '일정 적용 ↗' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(opener).toContainText('2027.01.07')
  await expect(opener).toContainText('2027.01.11')
  await expect(opener).toContainText('7일')
  await expect(rail.getByRole('button', { name: /후보 2/ })).toHaveAttribute(
    'aria-current',
    'true',
  )

  await expect(metrics).toContainText('2027-01-11 → 2027-01-18 UTC')
  // An unavailable body must clear old metrics; retry restores the paired result.
  await page.route('**/api/analysis/earth-visibility?**', (route) =>
    route.fulfill({ status: 503, json: { detail: 'NASA data not found' } }),
  )
  await rail.getByRole('button', { name: /후보 1/ }).click()
  await expect(metrics.getByRole('alert')).toContainText('(503)')
  await expect(metrics.locator('dd')).toHaveCount(0)
  await page.unroute('**/api/analysis/earth-visibility?**')
  await metrics.getByRole('button', { name: '분석 다시 시도' }).click()
  await expect(metrics.getByRole('definition')).toHaveCount(4)

  await page.setViewportSize({ width: 390, height: 844 })
  await opener.click()
  await expect(
    dialog.getByRole('button', { name: '일정 적용 ↗' }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '날짜 패널 닫기' }).click()
  await page.getByRole('link', { name: '상세 분석', exact: true }).click()
  await expect(page).toHaveURL(/view=analysis/)
  await expect(page.getByLabel('위도 (°)')).toBeVisible()
  await page.getByRole('link', { name: '미션 대시보드', exact: true }).click()
  await expect(
    page.getByRole('complementary', { name: '미션 조건' }),
  ).toBeVisible()
})
