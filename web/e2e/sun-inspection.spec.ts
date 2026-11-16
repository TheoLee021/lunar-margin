import { expect, test } from '@playwright/test'
import { mockDashboardRuns } from './dashboard-fixture.js'

test('inspecting a horizon crossing updates the warning while the map waits for the selected Sun', async ({
  page,
  request,
}) => {
  await mockDashboardRuns(page, request)
  await page.goto('/')
  await page
    .getByRole('button', { name: /후보 1/ })
    .first()
    .click()
  const time = page.getByLabel('태양 조명 검토 시각, 30분 단위')
  const timeline = page.getByLabel('타임라인 검토 시점')
  const utc = page.locator('output[for="mission-sun-time"]')
  await time.fill('352')
  await expect(timeline).toHaveValue('352')
  await expect(utc).toHaveText('2027-01-17 08:00 UTC')
  await expect(page.getByText(/일조 경고 · 선택 시각/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: '사진으로 보기' }),
  ).toBeEnabled()

  let releaseDirection!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseDirection = resolve
  })
  const nextTime = '2027-01-17T08:30:00.000Z'
  const selectedDirection = (url: URL) =>
    url.pathname.endsWith('/sunlight/sun-direction') &&
    url.searchParams.get('time') === nextTime
  await page.route(selectedDirection, async (route) => {
    await gate
    await route.continue()
  })
  try {
    await Promise.all([
      page.waitForRequest((req) => selectedDirection(new URL(req.url()))),
      timeline.press('ArrowRight'),
    ])
    await expect(time).toHaveValue('353')
    await expect(utc).toHaveText('2027-01-17 08:30 UTC')
    await expect(page.getByText(/태양 중심이 지형 수평선 위에/)).toBeVisible()
    const pending = page.getByRole('button', {
      name: '선택 시각 조명 계산 중…',
    })
    await expect(pending).toBeDisabled()
    await expect(pending).toHaveAttribute('aria-pressed', 'true')
  } finally {
    releaseDirection()
  }
  await page.getByRole('button', { name: '사진으로 보기' }).click()
  await expect(
    page.getByRole('button', { name: '선택 시각 햇빛' }),
  ).toBeEnabled()
  await time.fill('671')
  await expect(timeline).toHaveValue('671')
  await expect(utc).toHaveText('2027-01-23 23:30 UTC')
})
