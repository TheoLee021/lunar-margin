import { expect, test } from '@playwright/test'

test('site-targeted capture connects the default orbit to surface touchdown', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.goto('/orbit?departure=2027-01-06&arrival=2027-01-10&duration=14')
  const url = page.url()
  const landing = page.getByRole('button', { name: 'Landing', exact: true })
  const transfer = page.getByRole('button', {
    name: 'Earth–Moon transfer',
    exact: true,
  })
  await landing.click()
  await expect(page).toHaveURL(url)
  await expect(page.getByLabel('Earth departure · UTC')).toBeVisible()
  await expect(page.getByTestId('touchdown')).toHaveText(
    /2027-01-10 02:32:\d\d UTC/,
    { timeout: 30000 },
  )
  const touchdown = await page.getByTestId('touchdown').innerText()
  await page.getByRole('button', { name: '← Back to date planner' }).click()
  await expect(page.getByTestId('planner-touchdown')).toHaveText(touchdown, {
    timeout: 30000,
  })
  await page.getByRole('button', { name: 'View trajectory details ↗' }).click()
  await landing.click()
  await expect(page.getByTestId('touchdown')).toHaveText(touchdown, {
    timeout: 30000,
  })
  await expect(
    page.getByRole('img', {
      name: 'Height above terrain from powered descent to touchdown',
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: '3D terrain' }).click()
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 30000 },
  )
  await page.getByRole('button', { name: '2D trajectory' }).click()
  const slider = page.getByRole('slider', { name: 'Flight time' })
  await slider.focus()
  await slider.press('End')
  await expect(page.getByText('Powered descent → touchdown')).toBeVisible()
  await expect(page.getByText(/Height above terrain 0 m/)).toBeVisible()
  await transfer.click()
  await expect(
    page.getByRole('region', { name: 'Earth–Moon trajectory' }),
  ).toBeVisible()
  await expect(page.getByTestId('touchdown')).toBeHidden()
  await landing.click()
  await expect(page).toHaveURL(url)
  await expect(page.getByText(/Height above terrain 0 m/)).toBeVisible()
  await page.getByText('Landing site and lander settings').click()
  await page.getByLabel('Maximum thrust (N)').fill('1000')
  await page.getByRole('button', { name: 'Recalculate' }).click()
  await expect(
    page.getByText(/Descent constraints unmet · ENGINE_LIMIT/),
  ).toBeVisible({
    timeout: 30000,
  })
  await expect(page.getByTestId('touchdown')).toHaveText('Unavailable')
  await page.getByRole('button', { name: '← Back to date planner' }).click()
  await expect(page.getByTestId('planner-touchdown')).toHaveText(
    'Unavailable',
    { timeout: 30000 },
  )
})

test('date search recovers from a dropped request and busy solver, then shares touchdown with orbit', async ({
  page,
}) => {
  let attempts = 0
  await page.route('**/trajectory/flight-preview', (route) => {
    attempts += 1
    if (attempts === 1) return route.abort('failed')
    if (attempts === 2)
      return route.fulfill({
        status: 429,
        json: { detail: 'Reference flight computation busy' },
      })
    return route.continue()
  })
  await page.goto(
    '/?planner=compare&departure=2027-01-06&arrival=2027-01-11&duration=14&lat=-85.194602&lon=36.634114',
  )
  await expect(page.getByTestId('planner-touchdown')).toHaveText(
    '2027-01-11 02:31:08 UTC',
    { timeout: 30000 },
  )
  await page.getByRole('button', { name: 'View trajectory details ↗' }).click()
  await page.getByRole('button', { name: 'Landing', exact: true }).click()
  await expect(page.getByTestId('touchdown')).toHaveText(
    '2027-01-11 02:31:08 UTC',
  )
  expect(attempts).toBe(3)
})
