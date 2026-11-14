import { expect, test } from '@playwright/test'

// 스텁 API(`npm run stub`)를 띄운 상태에서 실행한다. 에러·빈 상태는 스텁의 특수 좌표로 만든다:
//   lat=-88.888 → 500,  lat=-87.777 → 일조 창이 없는 결과

test('analyzes a preset site and shows metrics, charts and the table', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('analysis-idle')).toBeVisible()

  await page.getByRole('button', { name: /Shackleton/ }).click()
  await page.getByRole('button', { name: '분석 실행' }).click()

  await expect(page.getByText('평균 일조율')).toBeVisible()
  await expect(page.getByText('최장 연속 암흑 시간')).toBeVisible()
  await expect(page.getByText('24시간당 일조 창 횟수')).toBeVisible()
  await expect(
    page.getByRole('img', { name: /수평선 고도의 시간 변화/ }),
  ).toBeVisible()
  await expect(page.getByRole('img', { name: /하늘 도표/ })).toBeVisible()

  // 차트 위 hover 시 값 표시
  const chart = page.getByRole('img', { name: /수평선 고도의 시간 변화/ })
  const box = await chart.boundingBox()
  if (!box) throw new Error('chart has no bounding box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByText(/여유 [+-]/)).toBeVisible()

  // 지구 가시성 전환
  await page.getByRole('tab', { name: '지구 가시성' }).click()
  await page.getByRole('button', { name: '분석 실행' }).click()
  await expect(page.getByText('평균 지구 가시율')).toBeVisible()
  await expect(page.getByText('최장 통신 두절 시간')).toBeVisible()
  await expect(page.getByText('지구 고도각', { exact: true })).toBeVisible()
})

test('shows validation, server error and empty states', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('위도 (°)').fill('-70')
  await page.getByRole('button', { name: '분석 실행' }).click()
  await expect(page.getByText('위도는 -90 ~ -80 사이여야 합니다')).toBeVisible()

  await page.getByLabel('위도 (°)').fill('-88.888')
  await page.getByRole('button', { name: '분석 실행' }).click()
  await expect(page.getByTestId('analysis-error')).toContainText('500')

  await page.getByLabel('위도 (°)').fill('-87.777')
  await page.getByRole('button', { name: '분석 실행' }).click()
  await expect(page.getByText(/일조 창이\(가\) 한 번도 없습니다/)).toBeVisible()
})
