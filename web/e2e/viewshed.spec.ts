import { expect, test } from '@playwright/test'
import { mockDashboardRuns } from './dashboard-fixture.js'
import { mockScheduledDepartures } from './launch-fixture.js'

test('3D viewshed follows the selected candidate and closes in overview', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  await mockScheduledDepartures(page)
  await mockDashboardRuns(page, request)
  await page.goto('/explore')
  const rail = page.getByRole('complementary', { name: 'Mission conditions' })
  const mask = (lat: number) =>
    page
      .waitForResponse(
        (r) => r.url().includes('/analysis/viewshed?lat=' + lat) && r.ok(),
      )
      .then((r) => r.json())
  const first = mask(-89.71)
  await rail.getByRole('button', { name: /Candidate 1/ }).click()
  const a = await first
  // The panel stays closed until asked for; the toolbar button carries the selected point's count.
  const panel = page.getByRole('region', { name: 'Viewshed' })
  await expect(panel).toHaveCount(0)
  await page.getByRole('button', { name: /^Viewshed \d+\/120 · 0 m/ }).click()
  await expect(panel.getByText('● Visible')).toBeVisible()
  const lines = panel.getByRole('checkbox', { name: 'Show sightlines' })
  await expect(lines).toBeChecked()
  await lines.uncheck()
  await panel.getByLabel('Observer height', { exact: true }).selectOption('40')
  await expect(
    panel.getByText('TOP 5 candidates · grid points visible from 40 m'),
  ).toBeVisible()
  const count = panel.getByRole('button', { name: /Candidate 1/ })
  await expect(count).toContainText(/\d+ \/ 120/, { timeout: 45_000 })
  const visible = (await count.innerText()).match(/\d+ \/ 120/)![0]
  await expect(panel.getByText(`Visible grid points ${visible}`)).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: `Viewshed ${visible.replace(' / ', '/')} · 40 m`,
    }),
  ).toBeVisible()
  const second = mask(-89.02)
  await rail.getByRole('button', { name: /Candidate 2/ }).click()
  expect((await second).cells).not.toBe(a.cells)
  await expect(panel.getByText('● Visible')).toBeVisible()
  await expect(lines).not.toBeChecked()
  await lines.check()
  await page.getByRole('button', { name: 'Top view' }).click()
  await expect(page.getByText('● Visible')).toHaveCount(0)
})
