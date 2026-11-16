import { expect, test } from '@playwright/test'

test('orbit preview keeps an independent descent separate from the mission arrival', async ({
  page,
}) => {
  await page.goto('/orbit?departure=2027-01-06&arrival=2027-01-10&duration=14')
  await page.getByRole('link', { name: '착륙까지 보기' }).click()
  await expect(
    page.getByText(
      '목표와 궤도가 정렬되지 않아 동력하강을 계산하지 않았습니다.',
    ),
  ).toBeVisible({ timeout: 30000 })
  await expect(page.getByTestId('touchdown')).toHaveText('산출되지 않음')
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 30000 },
  )
  await page.getByRole('button', { name: '독립 하강 예시 보기' }).click()
  const timeline = page.getByRole('slider', { name: '비행 시점' })
  await expect(timeline).toBeVisible({ timeout: 15000 })
  await timeline.focus()
  await timeline.press('End')
  await expect(page.getByText(/예시 하강 시작 후 \d+초/)).toBeVisible()
  await expect(page.getByTestId('touchdown')).toHaveText('산출되지 않음')
  await page.getByRole('button', { name: '진입 궤도로 돌아가기' }).click()
  await expect(
    page.getByText('달 궤도에서 착륙까지', { exact: true }),
  ).toBeVisible()
})
