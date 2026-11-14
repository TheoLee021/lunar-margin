import { expect, test } from '@playwright/test'

test('mission HUD can select a candidate and recover from an empty filter', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 30_000 },
  )
  await expect(page.locator('.cesium-widget canvas')).toHaveCount(1)
  const rail = page.getByRole('complementary', { name: '미션 조건' })
  await rail.getByRole('button', { name: /후보 2/ }).click()
  await expect(rail.getByRole('button', { name: /후보 2/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  await page.getByRole('button', { name: '선택 지점 3D로 보기' }).click()
  await page.getByRole('button', { name: '위에서 보기' }).click()
  const slope = page.getByRole('slider', { name: /경사 ≤/ })
  await slope.fill('0')
  await expect(
    rail.getByText('조건을 만족하는 예시 후보가 없습니다. 필터를 완화하세요.'),
  ).toBeVisible()
  await slope.fill('12')
  await expect(rail.getByRole('button', { name: /후보 2/ })).toBeVisible()
  await page.getByRole('link', { name: '상세 분석', exact: true }).click()
  await expect(page).toHaveURL(/view=analysis/)
  await expect(page.getByLabel('위도 (°)')).toBeVisible()
  await page.getByRole('link', { name: '미션 대시보드', exact: true }).click()
  await expect(
    page.getByRole('complementary', { name: '미션 조건' }),
  ).toBeVisible()
})
