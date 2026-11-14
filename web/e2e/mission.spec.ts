import { expect, test } from '@playwright/test'

test('mission HUD can select a candidate and recover from an empty filter', async ({
  page,
}) => {
  await page.goto('/')
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  await rail.getByRole('button', { name: /후보 2/ }).click()
  await expect(rail.getByRole('button', { name: /후보 2/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  const slope = page.getByRole('slider', { name: /경사 ≤/ })
  await slope.fill('0')
  await expect(
    rail.getByText('조건을 만족하는 예시 후보가 없습니다. 필터를 완화하세요.'),
  ).toBeVisible()
  await slope.fill('12')
  await expect(rail.getByRole('button', { name: /후보 2/ })).toBeVisible()
})
