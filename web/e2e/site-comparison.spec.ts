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
          min_link_margin_db: 15 - index,
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

test('the dialog compares the checked candidates without selecting a map site and starts over for a new result', async ({
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
  await page.goto('/explore')
  const rail = page.getByRole('complementary', { name: 'Mission conditions' })
  const open = rail.getByRole('button', { name: 'Compare candidates' })
  const dialog = page.getByRole('dialog', {
    name: 'TOP 5 candidate comparison',
  })
  const checked = dialog.getByRole('checkbox', { checked: true })
  // The candidates to compare are chosen in the dialog: all five until it is narrowed down.
  await expect(rail.getByRole('checkbox')).toHaveCount(0)
  await open.click()
  await expect(checked).toHaveCount(5)
  for (const rank of [2, 4, 5])
    await dialog
      .getByRole('checkbox', { name: `Compare candidate ${rank}` })
      .uncheck()
  expect(analyses).toBe(0)
  await expect(page).not.toHaveURL(/site=/)
  await expect(
    dialog.getByRole('img', { name: 'Radar of six metrics per candidate' }),
  ).toBeVisible()
  await expect(dialog.locator('svg polygon[data-candidate]')).toHaveCount(2)
  await expect(
    dialog.getByRole('columnheader', { name: 'Candidate 1', exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('columnheader', { name: 'Candidate 3', exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('columnheader', { name: 'Candidate 2', exact: true }),
  ).toHaveCount(0)
  await expect(
    dialog
      .getByRole('table', { name: 'Candidate actual metrics' })
      .getByRole('row')
      .filter({ hasText: 'Sunlight' }),
  ).toContainText('80.0%')
  // The most favourable value of each row is marked among the compared candidates.
  await expect(
    dialog
      .getByRole('table', { name: 'Candidate actual metrics' })
      .getByRole('row')
      .filter({ hasText: 'Sunlight' })
      .locator('td[data-best]'),
  ).toHaveText('80.0%')
  await expect(
    dialog.getByRole('row').filter({ hasText: 'RF link margin' }),
  ).toContainText('15.0 dB')
  await expect(
    dialog
      .getByRole('table', { name: 'Candidate margins per condition' })
      .getByRole('row')
      .filter({ hasText: 'Longest darkness' }),
  ).toContainText('+12.0 h')
  await dialog.screenshot({
    path: 'test-results/site-comparison-desktop.png',
  })
  const before = await dialog
    .locator('svg polygon[data-candidate]')
    .first()
    .getAttribute('points')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await open.click()
  await dialog.getByRole('checkbox', { name: 'Compare candidate 2' }).check()
  await expect(dialog.locator('svg polygon[data-candidate]')).toHaveCount(3)
  await expect(
    dialog.locator('svg polygon[data-candidate]').first(),
  ).toHaveAttribute('points', before!)
  await dialog.getByRole('button', { name: 'Close comparison' }).click()
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/candidates/runs/' + first.id),
    ),
    rail.getByRole('button', { name: 'Refresh results' }).click(),
  ])
  await open.click()
  await expect(checked).toHaveCount(3)
  await expect(
    dialog.getByRole('checkbox', { name: 'Compare candidate 3' }),
  ).toBeChecked()
  await dialog.getByRole('button', { name: 'Close comparison' }).click()
  first.id = 'saved-dashboard-replacement'
  await page.route(
    '**/api/candidates/runs/saved-dashboard-replacement',
    (route) => route.fulfill({ json: first }),
  )
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/candidates/runs/saved-dashboard-replacement'),
    ),
    rail.getByRole('button', { name: 'Refresh results' }).click(),
  ])
  // A new saved result starts over with all five.
  await open.click()
  await expect(checked).toHaveCount(5)
  await dialog.getByRole('checkbox', { name: 'Compare candidate 1' }).uncheck()
  await expect(checked).toHaveCount(4)
  await dialog.getByRole('button', { name: 'Close comparison' }).click()
  await page
    .getByRole('button', { name: 'Compare dates and trajectory' })
    .click()
  const planner = page.getByRole('dialog')
  await planner
    .getByLabel('기준 착륙일 · UTC', { exact: true })
    .fill('2027-01-11')
  await planner
    .getByRole('combobox', { name: /착륙 후 표면 임무/ })
    .selectOption('7')
  await planner.getByRole('button', { name: '일정 적용 ↗' }).click()
  await expect(rail).toContainText('2027.01.11')
  await expect(rail.locator('ol button')).toHaveCount(5)
  await open.click()
  await expect(checked).toHaveCount(5)
  // Selecting from the comparison is explicit: it picks the map site and leaves the dialog.
  await dialog.getByRole('button', { name: 'Select candidate 3' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/site=saved-1-3/)
  await expect(
    rail.getByRole('button', { name: /Candidate 3/ }),
  ).toHaveAttribute('aria-current', 'true')
})

test('all five candidates and their actual metrics fit a mobile comparison dialog', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const runs = await mockDashboardRuns(page, request)
  addComparisonMetrics(runs)
  await page.goto('/explore')
  const rail = page.getByRole('complementary', { name: 'Mission conditions' })
  const open = rail.getByRole('button', { name: 'Compare candidates' })
  await open.click()
  const dialog = page.getByRole('dialog', {
    name: 'TOP 5 candidate comparison',
  })
  await expect(dialog.locator('svg polygon[data-candidate]')).toHaveCount(5)
  await expect(
    dialog.getByRole('table', { name: 'Candidate actual metrics' }),
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
  await dialog
    .getByRole('button', { name: 'Clear comparison selection' })
    .click()
  await expect(
    dialog.getByText('Check candidates to compare their actual metrics.'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Close comparison' }).click()
  Object.assign(runs[0]!.candidates[4]!, { terrain: null })
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/candidates/runs/' + runs[0]!.id),
    ),
    rail.getByRole('button', { name: 'Refresh results' }).click(),
  ])
  await open.click()
  await dialog.getByRole('checkbox', { name: 'Compare candidate 5' }).check()
  await expect(dialog.locator('svg polygon[data-candidate]')).toHaveCount(0)
  await expect(
    dialog
      .getByRole('table', { name: 'Candidate actual metrics' })
      .getByRole('row')
      .filter({ hasText: 'Local slope P95' })
      .getByRole('cell')
      .first(),
  ).toHaveText('—')
  await expect(
    dialog
      .getByRole('table', { name: 'Candidate margins per condition' })
      .getByRole('row')
      .filter({ hasText: 'Local slope P95' })
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
  await page.goto('/explore')
  await page.getByRole('button', { name: 'Compare candidates' }).click()
  const dialog = page.getByRole('dialog', {
    name: 'TOP 5 candidate comparison',
  })
  for (const rank of [2, 3, 4, 5])
    await dialog
      .getByRole('checkbox', { name: `Compare candidate ${rank}` })
      .uncheck()
  await expect(dialog.locator('svg polygon[data-candidate]')).toHaveCount(0)
  await expect(dialog.locator('g[data-candidate] circle')).toHaveCount(4)
  for (const metric of ['Local slope P95', 'Local roughness P95']) {
    const values = dialog.getByRole('table', {
      name: 'Candidate actual metrics',
    })
    const margins = dialog.getByRole('table', {
      name: 'Candidate margins per condition',
    })
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
