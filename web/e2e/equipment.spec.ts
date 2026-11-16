/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { mockDashboardRuns } from './dashboard-fixture.js'

// Locate the gold cutting head in the unobstructed middle of the 1500×960
// viewport. A changing odometer alone cannot detect a camera locked on the body.
async function cuttingHeadX(page: Page): Promise<number | null> {
  const frame = await page.screenshot({
    clip: { x: 500, y: 345, width: 500, height: 275 },
  })
  return page.evaluate(async (png) => {
    const blob = await (await fetch(`data:image/png;base64,${png}`)).blob()
    const bitmap = await createImageBitmap(blob)
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext(
      '2d',
    )!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const { width, data } = context.getImageData(0, 0, 500, 275)
    let sum = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!,
        g = data[i + 1]!,
        b = data[i + 2]!
      if (r > 150 && g > 90 && g < 0.92 * r && b < 0.65 * g) {
        sum += (i / 4) % width
        count++
      }
    }
    return count >= 10 ? sum / count : null
  }, frame.toString('base64'))
}

test('operator equipment follows the review time and recovers a partial visibility failure', async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000)
  await mockDashboardRuns(page, request)
  await page.setViewportSize({ width: 1500, height: 960 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let failSun = false
  const observed = new Set<string>()
  await page.route('**/api/analysis/illumination?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('observer_height_m') === '10') {
      observed.add(params.get('start')!)
      if (failSun)
        return route.fulfill({ status: 503, json: { detail: 'Unavailable' } })
    }
    return route.continue()
  })
  await page.goto('/?operator=terra-nova-works')
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 45_000 },
  )
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  await rail.getByRole('button', { name: /후보 1/ }).click()
  const drive = page.getByRole('button', { name: '트렌처 주행' })
  await expect(drive).toBeEnabled({ timeout: 60_000 })
  await expect(page.getByLabel('가까이 볼 장비')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '장비 가까이 보기' }),
  ).toHaveCount(0)
  await drive.click()
  await expect(page.getByText(/이동 거리 [1-9]\d* m/)).toBeVisible()
  const positions: number[] = []
  await expect
    .poll(
      async () => {
        const x = await cuttingHeadX(page)
        if (x !== null) positions.push(x)
        return positions.length
          ? Math.max(...positions) - Math.min(...positions)
          : 0
      },
      { intervals: [100, 200], timeout: 15_000 },
    )
    .toBeGreaterThan(80)
  await expect
    .poll(() => observed.has('2027-01-10T00:00:00Z'), { timeout: 60_000 })
    .toBe(true)
  await page.getByRole('button', { name: '지구 방향 끄기' }).click()
  await expect(
    page.getByRole('button', { name: '지구 방향 켜기' }),
  ).toHaveAttribute('aria-pressed', 'false')
  const picker = page.getByLabel('장비를 배치할 운영사')
  const model = page.waitForResponse(
    (r) => r.url().endsWith('/models/rover.glb') && r.ok(),
  )
  await picker.selectOption('vestige-resources')
  const rover = page.getByRole('button', { name: '시추 로버 주행' })
  await expect(rover).toBeEnabled({ timeout: 60_000 })
  await rover.click()
  await expect(page.getByText(/이동 거리 [1-9]\d* m/)).toBeVisible()
  await model
  await page.screenshot({ path: info.outputPath('rover-drive.png') })
  await page.getByRole('button', { name: '위에서 보기' }).click()
  await picker.selectOption('helios-grid')
  failSun = true
  await page.getByLabel('타임라인 검토 시점').fill('2')
  await expect
    .poll(() => observed.has('2027-01-10T01:00:00Z'), { timeout: 30_000 })
    .toBe(true)
  const retry = page.getByRole('button', { name: '장비 분석 다시 시도' })
  await expect(retry).toBeVisible({ timeout: 60_000 })
  failSun = false
  await retry.click()
  await expect(page.getByText(/수직 태양광을 세우고 전력을 판다/)).toBeVisible({
    timeout: 60_000,
  })
  await expect(retry).toHaveCount(0)
  expect(errors).toEqual([])
})
