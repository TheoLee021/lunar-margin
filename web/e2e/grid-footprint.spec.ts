/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { mockDashboardRuns } from './dashboard-fixture.js'

test('a high lunar ridge keeps its 500m footprint visible after zooming', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const runs = await mockDashboardRuns(page, request)
  // Real Jan 9 candidate: Moon tiles place this ridge about 5.2km above the datum.
  // Earth's ground-classification height table stops at about 2.6km here.
  const ridge = {
    ...runs[0]!.candidates[0]!,
    id: 'high-lunar-ridge',
    rank: 1,
    lat_deg: -86.029123,
    lon_deg: 5.000645,
    x_m: 10500,
    y_m: 120000,
    grid_spacing_m: 500,
  }
  runs[0]!.candidates = [ridge]
  await page.route('**/api/analysis/**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(/^https?:\/\/[^/]+\/api/, 'http://localhost:8765'),
    }),
  )
  await page.goto('/explore')
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    {
      timeout: 30_000,
    },
  )
  await page
    .getByRole('complementary', { name: 'Mission conditions' })
    .getByRole('button', { name: /Candidate 1/ })
    .click()
  // Check the actual rendered fill below the number, excluding its blue label.
  await expect(async () => {
    const png = await page.screenshot({
      clip: { x: 650, y: 500, width: 140, height: 50 },
    })
    const bluePixels = await page.evaluate(async (encoded) => {
      const blob = await (
        await fetch(`data:image/png;base64,${encoded}`)
      ).blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      let blue = 0
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!,
          g = data[i + 1]!,
          b = data[i + 2]!
        if (
          b > 100 &&
          b > 1.3 * r &&
          b < 2.8 * r &&
          g > 0.55 * b &&
          g < 0.9 * b
        )
          blue++
      }
      return blue
    }, png.toString('base64'))
    expect(bluePixels).toBeGreaterThan(300)
  }).toPass({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Deselect candidate' }).click()
  await page.mouse.click(720, 505)
  await expect(
    page.getByRole('complementary', { name: 'Selected site' }),
  ).toBeVisible()
})
