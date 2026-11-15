import { expect, test } from '@playwright/test'

test('returning from candidate search keeps the selected mission site', async ({
  page,
}) => {
  await page.goto('/')
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  await rail.getByRole('button', { name: /후보 2/ }).click()
  await expect(rail.getByRole('button', { name: /후보 2/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  await page.getByRole('button', { name: '후보지 탐색', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '임무 조건 입력' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '미션 대시보드', exact: true }).click()
  await expect(rail.getByRole('button', { name: /후보 2/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
})
