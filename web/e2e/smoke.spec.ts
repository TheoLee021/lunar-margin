import { expect, test } from '@playwright/test'

test('app loads and reaches the API', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Lunar Margin' }),
  ).toBeVisible()
  await expect(page.getByTestId('api-status')).toHaveText('API connected')
})
