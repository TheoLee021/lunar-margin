import { expect, test } from '@playwright/test'
import { mockDashboardRuns } from './dashboard-fixture.js'
import { mockScheduledDepartures } from './launch-fixture.js'

// The generic fixture predates terrain metrics. Supply explicit synthetic values
// so this scenario exercises complete hexagons and real-unit requirement margins.
function addComparisonMetrics(
  runs: Awaited<ReturnType<typeof mockDashboardRuns>>,
  terrainCoverage = 1,
) {
  for (const run of runs) {
    Object.assign(run.config, {
      thresholds: {
        min_sun_fraction: 0.5,
        max_sun_dark_hours: 24,
        min_earth_fraction: 0.5,
        max_earth_blackout_hours: 12,
        max_terrain_slope_degrees: 10,
        max_terrain_roughness_m: 4,
      },
    })
    for (const [index, candidate] of run.candidates.entries()) {
      Object.assign(candidate, {
        sun: {
          fraction: 0.8 - index * 0.02,
          longest_dark_hours: 12 + index,
          windows_per_24h: 1,
          mean_elevation_deg: 2,
        },
        earth: {
          fraction: 0.9 - index * 0.02,
          longest_blackout_hours: 4 + index,
          windows_per_24h: 1,
          mean_elevation_deg: 4,
        },
        rf: {
          fraction: (252 - index * 6) / 336,
          evaluation_hours: 336,
          available_hours: 252 - index * 6,
          longest_blackout_hours: 12,
          min_link_margin_db: null,
          required_ebn0_db: 1,
          rx_required_dbw: -144,
        },
        terrain: {
          coverage_fraction: terrainCoverage,
          slope_p95_deg: 2 + index,
          roughness_p95_m: 1 + index * 0.2,
          assessment_radius_m: 250,
          slope_baseline_m: 160,
          roughness_window_m: 400,
          dem_pixel_m: 80,
          landing_safety_status: 'UNVERIFIED',
        },
      })
    }
  }
}

test('checked candidates compare saved values without selecting a map site and reset for a new result', async ({
  page,
  request,
}) => {
  const runs = await mockDashboardRuns(page, request)
  addComparisonMetrics(runs)
  await mockScheduledDepartures(page)
  const first = runs[0]!
  let analyses = 0
  page.on('request', (sent) => {
    if (/\/api\/analysis\//.test(sent.url())) analyses++
  })
  await page.goto('/')
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  await rail.getByRole('checkbox', { name: '후보 1 비교' }).check()
  await rail.getByRole('checkbox', { name: '후보 3 비교' }).check()
  expect(analyses).toBe(0)
  await expect(page).not.toHaveURL(/site=/)
  await rail.getByRole('button', { name: '선택 후보 비교 (2/5)' }).click()
  const dialog = page.getByRole('dialog', { name: 'TOP 5 후보 비교' })
  await expect(
    dialog.getByRole('img', { name: '후보별 여섯 지표 레이더' }),
  ).toBeVisible()
  await expect(dialog.locator('svg polygon[data-candidate]')).toHaveCount(2)
  await expect(
    dialog.getByRole('columnheader', { name: '후보 1', exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('columnheader', { name: '후보 3', exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('columnheader', { name: '후보 2', exact: true }),
  ).toHaveCount(0)
  await expect(
    dialog
      .getByRole('table', { name: '후보 실제 지표' })
      .getByRole('row')
      .filter({ hasText: '일조율' }),
  ).toContainText('80.0%')
  await expect(
    dialog.getByRole('row').filter({ hasText: 'RF 통신율' }),
  ).toContainText('75.0%')
  await expect(
    dialog
      .getByRole('table', { name: '후보 조건별 여유' })
      .getByRole('row')
      .filter({ hasText: '최장 연속 어둠' }),
  ).toContainText('+12.0 시간')
  await dialog.screenshot({
    path: 'test-results/site-comparison-desktop.png',
  })
  const before = await dialog
    .locator('svg polygon[data-candidate]')
    .first()
    .getAttribute('points')
  await page.keyboard.press('Escape')
  await rail.getByRole('checkbox', { name: '후보 2 비교' }).check()
  await rail.getByRole('button', { name: '선택 후보 비교 (3/5)' }).click()
  await expect(
    dialog.locator('svg polygon[data-candidate]').first(),
  ).toHaveAttribute('points', before!)
  await dialog.getByRole('button', { name: '비교 닫기' }).click()
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/candidates/runs/' + first.id),
    ),
    rail.getByRole('button', { name: '결과 새로고침' }).click(),
  ])
  await expect(rail.getByRole('checkbox', { checked: true })).toHaveCount(3)
  await expect(
    rail.getByRole('checkbox', { name: '후보 3 비교' }),
  ).toBeChecked()
  first.id = 'saved-dashboard-replacement'
  await page.route(
    '**/api/candidates/runs/saved-dashboard-replacement',
    (route) => route.fulfill({ json: first }),
  )
  await rail.getByRole('button', { name: '결과 새로고침' }).click()
  await expect(
    rail.getByRole('checkbox').filter({ has: page.locator(':checked') }),
  ).toHaveCount(0)
  await expect(rail.getByRole('checkbox', { checked: true })).toHaveCount(0)
  await expect(
    rail.getByRole('button', { name: '선택 후보 비교 (0/5)' }),
  ).toBeDisabled()
  await rail.getByRole('checkbox', { name: '후보 1 비교' }).check()
  await page.getByRole('button', { name: '미션 날짜 비교 열기' }).click()
  const planner = page.getByRole('dialog')
  await planner
    .getByLabel('기준 착륙일 · UTC', { exact: true })
    .fill('2027-01-11')
  await planner
    .getByRole('combobox', { name: /착륙 후 표면 임무/ })
    .selectOption('7')
  await planner.getByRole('button', { name: '일정 적용 ↗' }).click()
  await expect(rail).toContainText('2027-01-11 · 7일')
  await expect(rail.getByRole('checkbox', { checked: true })).toHaveCount(0)
  await expect(
    rail.getByRole('button', { name: '선택 후보 비교 (0/5)' }),
  ).toBeDisabled()
})

test('all five candidates and their actual metrics fit a mobile comparison dialog', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const runs = await mockDashboardRuns(page, request)
  addComparisonMetrics(runs)
  await page.goto('/')
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  for (let rank = 1; rank <= 5; rank++)
    await rail.getByRole('checkbox', { name: `후보 ${rank} 비교` }).check()
  await rail.getByRole('button', { name: '선택 후보 비교 (5/5)' }).click()
  const dialog = page.getByRole('dialog', { name: 'TOP 5 후보 비교' })
  await expect(dialog.locator('svg polygon[data-candidate]')).toHaveCount(5)
  await expect(
    dialog.getByRole('table', { name: '후보 실제 지표' }),
  ).toBeVisible()
  const fits = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return (
      box.left >= 0 &&
      box.right <= innerWidth &&
      box.top >= 0 &&
      box.bottom <= innerHeight
    )
  })
  expect(fits).toBe(true)
  await dialog.screenshot({ path: 'test-results/site-comparison-mobile.png' })
  await dialog.getByRole('button', { name: '비교 선택 모두 해제' }).click()
  await expect(
    dialog.getByText('후보를 체크하면 실제 지표를 비교할 수 있습니다.'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '비교 닫기' }).click()
  Object.assign(runs[0]!.candidates[4]!, { terrain: null })
  await rail.getByRole('button', { name: '결과 새로고침' }).click()
  await rail.getByRole('checkbox', { name: '후보 5 비교' }).check()
  await rail.getByRole('button', { name: '선택 후보 비교 (1/5)' }).click()
  await expect(dialog.locator('svg polygon[data-candidate]')).toHaveCount(0)
  await expect(
    dialog
      .getByRole('table', { name: '후보 실제 지표' })
      .getByRole('row')
      .filter({ hasText: '지역 경사 P95' })
      .getByRole('cell')
      .first(),
  ).toHaveText('—')
  await expect(
    dialog
      .getByRole('table', { name: '후보 조건별 여유' })
      .getByRole('row')
      .filter({ hasText: '지역 경사 P95' })
      .getByRole('cell')
      .last(),
  ).toHaveText('—')
})

test('partial terrain coverage hides both terrain values and their margins', async ({
  page,
  request,
}) => {
  const runs = await mockDashboardRuns(page, request)
  addComparisonMetrics(runs, 0.9)
  await page.goto('/')
  await page.getByRole('checkbox', { name: '후보 1 비교' }).check()
  await page.getByRole('button', { name: '선택 후보 비교 (1/5)' }).click()
  const dialog = page.getByRole('dialog', { name: 'TOP 5 후보 비교' })
  await expect(dialog.locator('svg polygon[data-candidate]')).toHaveCount(0)
  await expect(dialog.locator('g[data-candidate] circle')).toHaveCount(4)
  for (const metric of ['지역 경사 P95', '지역 거칠기 P95']) {
    const values = dialog.getByRole('table', { name: '후보 실제 지표' })
    const margins = dialog.getByRole('table', { name: '후보 조건별 여유' })
    await expect(
      values
        .getByRole('row')
        .filter({ hasText: metric })
        .getByRole('cell')
        .first(),
    ).toHaveText('—')
    await expect(
      margins
        .getByRole('row')
        .filter({ hasText: metric })
        .getByRole('cell')
        .last(),
    ).toHaveText('—')
  }
  await dialog.screenshot({ path: 'test-results/site-comparison-partial.png' })
})
