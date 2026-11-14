import { expect, test } from '@playwright/test'

// 실제 실행 목록/지도를 사용한다. 오래 걸리는 새 계산만 시작·진행 응답으로 대체한다.
test('mission input submits the requested JSON, shows progress, then opens the process map', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/candidates/runs')
  expect(response.ok()).toBe(true)
  const list = (await response.json()) as { runs: { id: string }[] }
  const runId =
    list.runs.find((run) => run.id === 'sample')?.id ?? list.runs[0]?.id
  expect(runId).toBeTruthy()
  let polls = 0
  await page.route('**/api/candidates/search', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      landing_date: '2027-01-01',
      mission_duration_days: 14,
      max_continuous_darkness_hours: 24,
      max_communication_blackout_hours: 6,
      max_terrain_slope_degrees: 10,
      search_region: 'south',
      optimization_priority: 'balanced',
      observer_height_m: null,
    })
    await route.fulfill({
      status: 202,
      json: { run_id: runId, state: 'queued', cached: false },
    })
  })
  await page.route(`**/api/candidates/runs/${runId}/status`, async (route) => {
    polls += 1
    await route.fulfill({
      json: {
        run_id: runId,
        state: polls > 1 ? 'done' : 'running',
        stage: polls > 1 ? 'done' : 'fine',
        done: 50,
        total: 100,
        error: null,
        started_at: null,
        updated_at: new Date().toISOString(),
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '후보지 탐색', exact: true }).click()
  await expect(
    page.getByText('현재 경사 조건은 저장만 하며 필터에 적용되지 않습니다.'),
  ).toBeVisible()
  await page.getByRole('button', { name: '후보지 탐색 실행' }).click()
  await expect(page.getByText('현재 단계 50 / 100 (50%)')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '후보지 탐색 실행' }),
  ).toBeEnabled({ timeout: 15_000 })
  for (let i = 1; i <= 6; i += 1) {
    await page.getByRole('tab', { name: new RegExp(`${i} / 6`) }).click()
    await expect(page.locator('#step-panel')).toContainText('무엇을')
  }
  await expect(page.getByRole('button', { name: /^후보 1번/ })).toBeVisible()
})

test('failed searches expose the error and permit another request', async ({
  page,
}) => {
  await page.route('**/api/candidates/search', (route) =>
    route.fulfill({
      status: 202,
      json: { run_id: 'failed-demo', state: 'queued', cached: false },
    }),
  )
  await page.route('**/api/candidates/runs/failed-demo/status', (route) =>
    route.fulfill({
      json: {
        run_id: 'failed-demo',
        state: 'failed',
        stage: 'fine',
        done: 0,
        total: 100,
        error: '데이터 읽기 실패',
        started_at: null,
        updated_at: new Date().toISOString(),
      },
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '후보지 탐색', exact: true }).click()
  await page.getByRole('button', { name: '후보지 탐색 실행' }).click()
  await expect(
    page.getByText('데이터 읽기 실패', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '후보지 탐색 실행' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: '후보지 탐색 실행' }).click()
  await expect(
    page.getByText('데이터 읽기 실패', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '후보지 탐색 실행' }),
  ).toBeEnabled()
})
