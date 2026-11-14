import { expect, test, type Page } from '@playwright/test'

// 실제 백엔드(api/)를 NASA 데이터와 함께 띄운 상태에서 실행한다:
//   cd api && uv run python -m lunar_margin.pipeline.fetch   # 처음 한 번
//   cd api && uv run fastapi dev src/lunar_margin/app/main.py
// 예시 프리셋 위치(2027-01 한 달)의 실제 계산 결과로 데모 시나리오를 검증한다.

async function metric(page: Page, label: string): Promise<string> {
  const value = page
    .locator('dt', { hasText: label })
    .locator('xpath=following-sibling::dd[1]')
  await expect(value).toBeVisible()
  return (await value.innerText()).trim()
}

function percent(text: string): number {
  const match = /^([\d.]+)%$/.exec(text)
  if (!match?.[1]) throw new Error(`not a percentage: ${text}`)
  return Number(match[1])
}

async function analyze(page: Page, preset: RegExp) {
  await page.getByRole('button', { name: preset }).click()
  await page.getByRole('button', { name: '분석 실행' }).click()
}

test('a sunlit ridge and a permanently shadowed crater give different answers', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('api-status')).toContainText('connected')

  // 능선: 한 달 중 상당 시간 햇빛을 받는다
  await analyze(page, /Connecting Ridge/)
  const ridge = percent(await metric(page, '평균 일조율'))
  expect(ridge).toBeGreaterThan(30)
  await expect(page.getByText('최장 연속 암흑 시간')).toBeVisible()
  await expect(page.getByText('24시간당 일조 창 횟수')).toBeVisible()
  await expect(
    page.getByRole('img', { name: /수평선 고도의 시간 변화/ }),
  ).toBeVisible()
  await expect(page.getByRole('img', { name: /하늘 도표/ })).toBeVisible()

  // 크레이터 안쪽: 지형이 사방을 가려 태양이 한 번도 뜨지 않는다
  await analyze(page, /Shackleton/)
  await expect(page.getByTestId('analysis-error')).toHaveCount(0)
  await expect.poll(async () => metric(page, '평균 일조율')).toBe('0.0%')
  await expect(page.getByText(/일조 창이\(가\) 한 번도 없습니다/)).toBeVisible()
})

test('shows Earth visibility metrics for a ridge site', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: '지구 가시성' }).click()
  await analyze(page, /Connecting Ridge/)

  const visible = percent(await metric(page, '평균 지구 가시율'))
  expect(visible).toBeGreaterThan(0)
  expect(visible).toBeLessThanOrEqual(100)
  await expect(page.getByText('최장 통신 두절 시간')).toBeVisible()
  await expect(page.getByText('지구 고도각', { exact: true })).toBeVisible()
})

test('mission thresholds explain why a site fails', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('최소 일조 비율 (%)').fill('99')
  await analyze(page, /Connecting Ridge/)

  await expect(page.getByText(/기준 미충족/)).toBeVisible()
})

test('rejects an out-of-range latitude before calling the API', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByLabel('위도 (°)').fill('-70')
  await page.getByRole('button', { name: '분석 실행' }).click()

  await expect(page.getByText('위도는 -90 ~ -80 사이여야 합니다')).toBeVisible()
})

test('shows an error state with the status when the server fails', async ({
  page,
}) => {
  // 실제 서버에 500을 내게 할 수 없어서 UI의 에러 처리만 응답을 가로채 검증한다
  await page.route('**/api/analysis/**', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'boom' }),
    }),
  )
  await page.goto('/')
  await analyze(page, /Connecting Ridge/)

  await expect(page.getByTestId('analysis-error')).toContainText('500')
})
