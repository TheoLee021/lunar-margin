import { expect, test } from '@playwright/test'
import { mockDashboardRuns } from './dashboard-fixture.js'

test('only a candidate shadowed at landing midnight gets the landing warning', async ({
  page,
  request,
}) => {
  await mockDashboardRuns(page, request)
  await page.goto('/')
  await expect(page.getByLabel('태양 조명 검토 시각, 30분 단위')).toHaveCount(0)
  const warning = page.getByRole('alert').filter({ hasText: '착륙 일조 경고' })
  await expect(warning).toHaveCount(0)
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  await rail.getByRole('button', { name: /후보 1/ }).click()
  await expect(warning).toContainText('2027-01-10 00:00 UTC')
  const timeline = page.getByLabel('타임라인 검토 시점')
  // At this ridge the Sun first clears the horizon at sample 353.
  await timeline.fill('353')
  await expect(timeline).toHaveValue('353')
  await expect(warning).toContainText('2027-01-10 00:00 UTC')
  await rail.getByRole('button', { name: /후보 2/ }).click()
  // The review time stays when the candidate changes; the warning is about landing midnight alone.
  await expect(timeline).toHaveValue('353')
  await expect(warning).toHaveCount(0)
})
