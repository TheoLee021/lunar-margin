import { expect, test } from '@playwright/test'

test('candidate comparison shows all six providers, unknown prices, and recovers from a quote error', async ({
  page,
}) => {
  await page.route('**/api/candidates/**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(/^https?:\/\/[^/]+\/api/, 'http://localhost:8765'),
    }),
  )
  let ready = false
  await page.route('**/api/pricing/providers/compare', (route) => {
    const input = route.request().postDataJSON() as {
      mass_kg: number
      departure_date: string
      landing_date: string
    }
    expect(input.mass_kg).toBe(48)
    expect(input.departure_date).toBe('2026-12-28')
    expect(input.landing_date).toBe('2027-01-01')
    return !ready
      ? route.fulfill({
          status: 503,
          json: { detail: 'Temporary provider lookup failure' },
        })
      : route.continue()
  })
  await page.goto(
    '/?view=search&run=synthetic&departure=2026-12-28&arrival=2027-01-01&duration=14&mass_kg=48&delivery=surface',
  )
  await page
    .getByRole('table')
    .getByRole('button', { name: /SP500_/ })
    .first()
    .click()
  const panel = page.getByRole('region', { name: '회사별 배송 비교' })
  await expect(panel.getByRole('alert')).toContainText('503')
  ready = true
  await panel.getByRole('button', { name: '다시 불러오기' }).click()
  await expect(panel.locator('article')).toHaveCount(6)
  for (const name of [
    'Blue Origin',
    'ispace-U.S.',
    'SpaceX',
    'Lockheed Martin Space',
    'Northrop Grumman Space Systems',
    'Voyager Technologies',
  ])
    await expect(
      panel.getByRole('heading', { name, exact: true }),
    ).toBeVisible()
  await expect(panel).toContainText('비교 가능한 공개 견적 없음')
  await expect(panel).toContainText('2028년 이전 불가')
  await expect(panel).toContainText('가격 미공개')
  await expect(panel).not.toContainText('최저 $')
  await expect(panel).toContainText('48kg')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(panel.locator('article')).toHaveCount(6)
})
