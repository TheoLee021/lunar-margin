import { expect, test } from '@playwright/test'
import { mockDashboardRuns } from './dashboard-fixture.js'
import { mockScheduledDepartures } from './launch-fixture.js'

test('playing the review time moves the sunlight and asks for precise shadows once it rests', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  await mockScheduledDepartures(page)
  await mockDashboardRuns(page, request)
  const sunlightMaps: string[] = []
  page.on('request', (sent) => {
    if (sent.url().includes('/sunlight/south-pole'))
      sunlightMaps.push(sent.url())
  })
  await page.goto('/')
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 30_000 },
  )
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  await rail.getByRole('button', { name: /후보 2/ }).click()
  const timeline = page
    .getByRole('complementary', { name: '선택한 지점' })
    .getByRole('region', { name: '미션 기간 타임라인' })
  const time = timeline.locator('output')
  await expect(time).toHaveText('D+0 00:00 · 2027-01-10 00:00 UTC')
  // The Moon is lit by the Sun at landing, with its sunlight maps, before the time moves.
  await expect(
    page.getByRole('button', { name: '사진으로 보기' }),
  ).toBeVisible()
  await expect.poll(() => sunlightMaps.length).toBeGreaterThan(0)

  const play = timeline.getByRole('button', { name: '햇빛 재생', exact: true })
  await expect(play).toBeEnabled()
  const before = sunlightMaps.length
  await timeline.getByLabel('햇빛 재생 속도').selectOption({ label: '3일/초' })
  await play.click()
  const pause = timeline.getByRole('button', { name: '햇빛 재생 일시정지' })
  await expect(pause).toBeVisible()
  await expect(time).toContainText(/^D\+[1-9]/)
  // No sunlight map is asked for while the Sun moves: the backend takes seconds for each.
  expect(sunlightMaps.length).toBe(before)

  await pause.click()
  await expect(play).toBeVisible()
  const rested = await time.innerText()
  expect(rested).not.toBe('D+0 00:00 · 2027-01-10 00:00 UTC')
  // At rest the Moon asks for the precise shadows of the time it stopped at, and the time stays.
  await expect.poll(() => sunlightMaps.length).toBeGreaterThan(before)
  await expect(time).toHaveText(rested)
  await expect(
    timeline.getByRole('slider', { name: '타임라인 검토 시점' }),
  ).not.toHaveValue('0')

  // Deselecting the candidate takes the timeline away, and the review time with it.
  await page.getByRole('button', { name: '후보 선택 해제' }).click()
  await rail.getByRole('button', { name: /후보 2/ }).click()
  await expect(time).toHaveText('D+0 00:00 · 2027-01-10 00:00 UTC')
})
