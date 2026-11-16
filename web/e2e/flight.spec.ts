import { expect, test } from '@playwright/test'

test('site-targeted capture connects the default orbit to surface touchdown', async ({
  page,
}) => {
  await page.goto('/orbit?departure=2027-01-06&arrival=2027-01-10&duration=14')
  await page.getByRole('link', { name: '착륙까지 보기' }).click()
  await expect(page.getByTestId('touchdown')).toHaveText(
    /2027-01-10 02:32:\d\d UTC/,
    { timeout: 30000 },
  )
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 30000 },
  )
  const slider = page.getByRole('slider', { name: '비행 시점' })
  await slider.focus()
  await slider.press('End')
  await expect(page.getByText('동력하강 → 표면 착륙')).toBeVisible()
  await expect(page.getByText(/지상고 0 m/)).toBeVisible()
  await page.getByText('착륙지와 착륙선 조건').click()
  await page.getByLabel('최대 추력 (N)').fill('1000')
  await page.getByRole('button', { name: '이 조건으로 다시 계산' }).click()
  await expect(page.getByText(/하강 조건 미충족 · ENGINE_LIMIT/)).toBeVisible({
    timeout: 30000,
  })
  await expect(page.getByTestId('touchdown')).toHaveText('산출되지 않음')
})
