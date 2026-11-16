import { expect, test } from '@playwright/test'

test('site-targeted capture connects the default orbit to surface touchdown', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.goto('/orbit?departure=2027-01-06&arrival=2027-01-10&duration=14')
  const url = page.url()
  const landing = page.getByRole('button', { name: '착륙', exact: true })
  const transfer = page.getByRole('button', {
    name: '지구–달 비행 궤도',
    exact: true,
  })
  await landing.click()
  await expect(page).toHaveURL(url)
  await expect(page.getByLabel('지구 출발일 · UTC')).toBeVisible()
  await expect(page.getByTestId('touchdown')).toHaveText(
    /2027-01-10 02:32:\d\d UTC/,
    { timeout: 30000 },
  )
  const touchdown = await page.getByTestId('touchdown').innerText()
  await page.getByRole('button', { name: '← 날짜 계획으로 돌아가기' }).click()
  await expect(page.getByTestId('planner-touchdown')).toHaveText(touchdown, {
    timeout: 30000,
  })
  await page.getByRole('button', { name: '이 일정의 궤도 보기 ↗' }).click()
  await landing.click()
  await expect(page.getByTestId('touchdown')).toHaveText(touchdown, {
    timeout: 30000,
  })
  await expect(
    page.getByRole('img', {
      name: '동력하강 시작부터 표면 착륙까지 경과 시간과 지상고',
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: '3D 지형' }).click()
  await expect(page.getByTestId('moon-viewer')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 30000 },
  )
  await page.getByRole('button', { name: '2D 궤도 · 착륙' }).click()
  const slider = page.getByRole('slider', { name: '비행 시점' })
  await slider.focus()
  await slider.press('End')
  await expect(page.getByText('동력하강 → 표면 착륙')).toBeVisible()
  await expect(page.getByText(/지상고 0 m/)).toBeVisible()
  await transfer.click()
  await expect(
    page.getByRole('region', { name: '지구–달 계산 궤도' }),
  ).toBeVisible()
  await expect(page.getByTestId('touchdown')).toBeHidden()
  await landing.click()
  await expect(page).toHaveURL(url)
  await expect(page.getByText(/지상고 0 m/)).toBeVisible()
  await page.getByText('착륙지와 착륙선 조건').click()
  await page.getByLabel('최대 추력 (N)').fill('1000')
  await page.getByRole('button', { name: '이 조건으로 다시 계산' }).click()
  await expect(page.getByText(/하강 조건 미충족 · ENGINE_LIMIT/)).toBeVisible({
    timeout: 30000,
  })
  await expect(page.getByTestId('touchdown')).toHaveText('산출되지 않음')
  await page.getByRole('button', { name: '← 날짜 계획으로 돌아가기' }).click()
  await expect(page.getByTestId('planner-touchdown')).toHaveText(
    '산출되지 않음',
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
    '/explore?planner=1&departure=2027-01-06&arrival=2027-01-11&duration=14&lat=-85.194602&lon=36.634114',
  )
  await expect(page.getByTestId('planner-touchdown')).toHaveText(
    '2027-01-11 02:31:08 UTC',
    { timeout: 30000 },
  )
  await page.getByRole('button', { name: '이 일정의 궤도 보기 ↗' }).click()
  await page.getByRole('button', { name: '착륙', exact: true }).click()
  await expect(page.getByTestId('touchdown')).toHaveText(
    '2027-01-11 02:31:08 UTC',
  )
  expect(attempts).toBe(3)
})
