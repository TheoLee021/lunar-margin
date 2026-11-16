import { expect, test, type Page } from '@playwright/test'

// 후보지 탐색 화면 시나리오. 백엔드 없이 스텁(합성 데이터)으로 돌린다:
//   터미널 1:  cd web && PORT=8765 npm run stub
//   터미널 2:  cd web && npm run e2e -- e2e/search.spec.ts
// 개발 서버가 이미 다른 포트에 떠 있으면 E2E_BASE_URL=http://localhost:<포트> 를 함께 준다.
// 이 파일은 /api/** 요청을 스텁으로 돌려 보내므로, 개발 서버가 어떤 백엔드를 보고 있어도 상관없다.
const STUB = process.env.STUB_URL ?? 'http://localhost:8765'

async function useStub(page: Page) {
  await page.route('**/api/**', (route) => {
    const url = route
      .request()
      .url()
      .replace(/^https?:\/\/[^/]+\/api/, STUB)
    return route.continue({ url })
  })
}

async function openSearch(page: Page) {
  await page.goto('/explore')
  await page.getByRole('button', { name: 'Site search' }).click()
  await expect(page.getByRole('tab', { name: /거친 격자/ })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await useStub(page)
})

test('walks through the six steps with numbers and explanations', async ({
  page,
}) => {
  await openSearch(page)

  const titles = [
    '거친 격자로 먼저 훑기',
    '유망한 곳만 세밀화',
    '세밀 결과',
    '필수 조건으로 거르기',
    '연결 영역 찾기',
    '서로 떨어진 대표 후보 선정',
  ]
  for (const [i, title] of titles.entries()) {
    await page.getByRole('tab', { name: new RegExp(`${i + 1} / 6`) }).click()
    const panel = page.locator('#step-panel')
    await expect(panel).toContainText(title)
    await expect(panel).toContainText('무엇을')
    await expect(panel).toContainText('왜')
    await expect(panel.locator('dd').first()).toHaveText(/\d/)
  }

  // 마지막 단계에서는 후보 번호 마커가 지도에 나온다
  await expect(page.getByRole('button', { name: /^후보 1번/ })).toBeVisible()
})

test('moves between steps with the keyboard and plays automatically', async ({
  page,
}) => {
  await openSearch(page)

  await page.getByRole('tab', { name: /1 \/ 6/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { selected: true })).toContainText(
    '세밀화 영역',
  )
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { selected: true })).toContainText(
    '선정 후보',
  )
  await page.keyboard.press('Home')
  await expect(page.getByRole('tab', { selected: true })).toContainText(
    '거친 격자',
  )

  await page.getByRole('button', { name: '▶ 재생' }).click()
  await expect(
    page.getByRole('tab', { name: /2 \/ 6/, selected: true }),
  ).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '⏸ 멈춤' }).click()
  await expect(page.getByRole('button', { name: '▶ 재생' })).toBeVisible()
})

test('shows the funnel, drop reasons, distributions and warnings', async ({
  page,
}) => {
  await openSearch(page)

  await expect(page.getByTestId('search-warnings')).toBeVisible()
  await expect(page.getByText('점이 단계마다 몇 개 남나')).toBeVisible()
  await expect(page.getByText('탈락 사유', { exact: true })).toBeVisible()
  await expect(page.getByText('후보 수(Top-K) 한도 밖')).toBeVisible()
  await expect(
    page.getByRole('img', { name: /^일조율: 최소 .* 중앙값 .* 최대/ }),
  ).toBeVisible()
})

test('opens a candidate and loads the time-series analysis for it', async ({
  page,
}) => {
  await openSearch(page)

  // 표의 ID 버튼을 누른다 (지도 마커는 원이 아니라 라벨까지 포함한 영역의 중심을 누르게 된다)
  await page
    .getByRole('table')
    .getByRole('button', { name: /SP500_/ })
    .first()
    .click()
  const detail = page.getByRole('region', { name: '선택한 지점 상세' })
  await expect(detail).toContainText('후보 1번')
  await expect(detail).toContainText('적격 판정')

  await detail.getByRole('button', { name: '시계열로 자세히 보기' }).click()
  // 후보 사실 표에도 같은 문구가 있어서, 분석이 실제로 불러와졌는지는 시계열 차트로 확인한다
  const chart = detail.getByRole('img', { name: /수평선 고도의 시간 변화/ })
  await expect(chart).toBeVisible()
  await expect(detail.getByText('24시간당 일조 창 횟수')).toBeVisible()
  await detail.getByRole('tab', { name: '지구 가시성' }).click()
  await expect(chart).toBeVisible()
  await expect(detail.getByText('최장 통신 두절 시간')).toBeVisible()
})

test('shows the empty and error states', async ({ page }) => {
  await page.route('**/api/candidates/runs', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ runs: [] }),
    }),
  )
  await openSearch2(page)
  await expect(page.getByTestId('search-empty')).toContainText(
    'pipeline.candidates',
  )

  await page.unroute('**/api/candidates/runs')
  await page.route('**/api/candidates/runs', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'boom' }),
    }),
  )
  await openSearch2(page)
  await expect(page.getByTestId('search-error')).toContainText('500')
})

// 탭 이름이 아직 없는 상태(빈·에러)에서 쓰는 진입 헬퍼
async function openSearch2(page: Page) {
  await page.goto('/explore')
  await page.getByRole('button', { name: 'Site search' }).click()
}

test('has no horizontal overflow on a phone-width screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await openSearch(page)

  // e2e 쪽 tsconfig 에는 DOM 타입이 없어서 식을 문자열로 넘긴다.
  const overflow: boolean = await page.evaluate(
    'document.documentElement.scrollWidth > document.documentElement.clientWidth',
  )
  expect(overflow).toBe(false)
})
