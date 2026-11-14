import { expect, test } from '@playwright/test'

// Needs VITE_CESIUM_ION_TOKEN in web/.env.local (the backend is not required).
test('the Moon loads and the intro flight reaches the south pole', async ({
  page,
}) => {
  await page.goto('/')
  const viewer = page.getByTestId('moon-viewer')
  await expect(viewer).toHaveAttribute('data-state', 'ready', {
    timeout: 30_000,
  })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(viewer).toHaveAttribute('data-intro', 'done', {
    timeout: 30_000,
  })
  await expect(
    page.getByRole('button', { name: 'Reset view to north up' }),
  ).toBeVisible()
})
