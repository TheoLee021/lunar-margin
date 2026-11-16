import { expect, test } from '@playwright/test'

test('the first screen searches by mission conditions and links every stage', async ({
  page,
}) => {
  await page.goto('/explore')
  const stages = page.getByRole('navigation', {
    name: 'Mission planning stages',
  })
  await expect(stages.getByRole('link', { name: /Search/ })).toHaveAttribute(
    'aria-current',
    'step',
  )
  // Nothing but the search over the Moon.
  await expect(page.getByRole('complementary')).toHaveCount(0)
  const form = page.getByRole('form', {
    name: 'Find a landing site at the lunar south pole',
  })
  await form.getByLabel('Landing date · UTC').fill('2027-01-11')
  await form.getByLabel('Mission duration').selectOption('7')
  await form.getByLabel(/Min\. sunlight/).fill('120')
  await form.getByRole('button', { name: 'Search' }).click()
  await expect(form.getByRole('alert')).toHaveText(
    'Enter a percentage from 0 to 100.',
  )

  await form.getByLabel(/Min\. sunlight/).fill('70')
  await form.getByLabel(/Max\. regional slope/).fill('10')
  await form.getByRole('button', { name: 'Search' }).click()
  await expect(page).toHaveURL(/\/explore\?.*planner=1/)
  const params = new URL(page.url()).searchParams
  expect(Object.fromEntries(params)).toMatchObject({
    departure: '2027-01-07',
    arrival: '2027-01-11',
    duration: '7',
    min_sun: '70',
    min_comm: 'none',
    max_slope: '10',
  })
  const planner = page.locator('#datePlanner')
  await expect(planner).toContainText('sunlight ≥ 70%')

  await planner.getByRole('link', { name: /3D Explore/ }).click()
  await expect(planner).toHaveCount(0)
  await expect(page.getByTestId('api-status')).toBeVisible()
  await page.getByRole('link', { name: /Search/ }).click()
  await expect(form.getByLabel(/Min\. sunlight/)).toHaveValue('70')
})
