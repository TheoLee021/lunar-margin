import { expect, test } from '@playwright/test'

// Needs VITE_CESIUM_ION_TOKEN in web/.env.local (the backend is not required).
test('the Moon loads looking down on the south pole', async ({ page }) => {
  await page.goto('/')
  const viewer = page.getByTestId('moon-viewer')
  await expect(viewer).toHaveAttribute('data-state', 'ready', {
    timeout: 30_000,
  })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Reset view to north up' }),
  ).toBeVisible()
})

test('clicking the Moon fills the analysis coordinates', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 30_000 },
  )
  const lat = page.getByLabel('위도 (°)')
  const lon = page.getByLabel('경도 (°E)')
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('no viewport')
  // Right of the form panel, above the credits strip: open Moon surface in the start view.
  // Retried because picking needs the first tiles to have rendered.
  await expect(async () => {
    await page.mouse.click(viewport.width * 0.7, viewport.height * 0.4)
    await expect(lat).not.toHaveValue('-89.7', { timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  await expect(lat).toHaveValue(/^-\d+\.\d{4}$/)
  await expect(lon).toHaveValue(/^-?\d+\.\d{4}$/)
})
