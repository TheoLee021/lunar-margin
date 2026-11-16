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
  await page.goto('/')
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  await rail.getByRole('button', { name: /후보 1/ }).click()
  const mask = (lat: number) =>
    page
      .waitForResponse(
        (r) => r.url().includes('/analysis/viewshed?lat=' + lat) && r.ok(),
      )
      .then((r) => r.json())
  const first = mask(-89.71)
  await page.getByRole('button', { name: '선택 지점 3D로 보기' }).click()
  const a = await first
  await expect(page.getByText('● 보임')).toBeVisible()
  await rail.getByLabel('가시권 비교 높이').selectOption('40')
  const count = rail.getByText(/40 m에서 보이는 점/).first()
  await expect(count).toBeVisible({ timeout: 45_000 })
  const visible = (await count.innerText()).split('보이는 점 ')[1]
  await expect(page.getByText(`보이는 격자점 ${visible}`)).toBeVisible()
  await expect(page.getByLabel('관측 높이', { exact: true })).toHaveValue('40')
  const second = mask(-89.02)
  await rail.getByRole('button', { name: /후보 2/ }).click()
  expect((await second).cells).not.toBe(a.cells)
  await expect(page.getByText('● 보임')).toBeVisible()
  await page.getByRole('button', { name: '위에서 보기' }).click()
  await expect(page.getByText('● 보임')).toHaveCount(0)
})
