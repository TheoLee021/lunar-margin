import { expect, test } from '@playwright/test'

test('candidate comparison shows all six providers, unknown prices, and recovers from a quote error', async ({
  page,
}) => {
  await page.route('**/api/candidates/**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(/^https?:\/\/[^/]+\/api/, 'http://localhost:8765'),
    }),
  )
  let ready = false
  await page.route('**/api/pricing/providers/compare', (route) => {
    const input = route.request().postDataJSON() as {
      mass_kg: number
      departure_date: string
      landing_date: string
    }
    expect(input.mass_kg).toBe(48)
    expect(input.departure_date).toBe('2026-12-28')
    expect(input.landing_date).toBe('2027-01-01')
    return !ready
      ? route.fulfill({
          status: 503,
          json: { detail: 'Temporary provider lookup failure' },
        })
      : route.continue()
  })
  await page.goto(
    '/?view=search&run=synthetic&departure=2026-12-28&arrival=2027-01-01&duration=14&mass_kg=48&delivery=surface',
  )
  await page
    .getByRole('table')
    .getByRole('button', { name: /SP500_/ })
    .first()
    .click()
  const panel = page.getByRole('region', { name: '회사별 배송 비교' })
  await expect(panel.getByRole('alert')).toContainText('503')
  ready = true
  await panel.getByRole('button', { name: '다시 불러오기' }).click()
  await expect(panel.locator('article')).toHaveCount(6)
  for (const name of [
    'Blue Origin',
    'ispace-U.S.',
    'SpaceX',
    'Lockheed Martin Space',
    'Northrop Grumman Space Systems',
    'Voyager Technologies',
  ])
    await expect(
      panel.getByRole('heading', { name, exact: true }),
    ).toBeVisible()
  await expect(panel).toContainText('최저 예상 비용')
  await expect(panel).toContainText('공통 모델 예상')
  await expect(panel).toContainText('고정비 $500,000')
  await expect(panel).toContainText('2028년 이전 불가')
  await expect(panel).toContainText('가격 미공개')
  await expect(panel).not.toContainText('최저 예상 비용 $0')
  await expect(panel).toContainText('48kg')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(panel.locator('article')).toHaveCount(6)
})

test('launch departure changes independently from the user landing date', async ({
  page,
}) => {
  await page.route('**/api/pricing/providers/launches', (route) =>
    route.fulfill({
      json: {
        timezone: 'UTC',
        sources: [
          {
            name: 'Space Launch Schedule',
            url: 'https://www.spacelaunchschedule.com/',
            fetched_at: '2026-11-15T08:00:00Z',
            stale: false,
            error: null,
          },
        ],
        launches: [
          {
            id: 'griffin-1',
            provider_id: 'voyager',
            name: 'Griffin Mission One',
            departure_date: '2027-01-06',
            label: 'NET January 6 · TBD',
            confirmed: false,
            sources: [
              {
                name: 'Space Launch Schedule',
                url: 'https://www.spacelaunchschedule.com/launch/falcon-heavy-griffin-mission-one/',
                label: 'NET January 6',
              },
            ],
          },
          {
            id: 'blue-moon-pathfinder',
            provider_id: 'blue_origin',
            name: 'Blue Moon Pathfinder',
            departure_date: null,
            label: 'March 2027 · TBD',
            confirmed: false,
            sources: [
              {
                name: 'Space Launch Schedule',
                url: 'https://www.spacelaunchschedule.com/launch/new-glenn-blue-moon-pathfinder/',
                label: 'March 2027',
              },
            ],
          },
        ],
      },
    }),
  )
  await page.goto(
    '/?planner=1&departure=2027-01-04&arrival=2027-01-10&duration=14',
  )
  const picker = page.getByRole('region', { name: '발사 일정에서 출발일 선택' })
  await picker
    .getByLabel('발사 일정에서 출발일 선택 · UTC')
    .selectOption('griffin-1')
  await expect(
    page.getByLabel('기준 출발일 · UTC', { exact: true }),
  ).toHaveValue('2027-01-06')
  const landing = page.getByLabel('기준 착륙일 · UTC', { exact: true })
  await expect(landing).toHaveValue('2027-01-10')
  await landing.fill('2027-01-12')
  await expect(
    page.getByLabel('기준 출발일 · UTC', { exact: true }),
  ).toHaveValue('2027-01-06')
  await expect(landing).toHaveValue('2027-01-12')
  const allMissions = picker.getByRole('region', {
    name: '회사별 전체 달 임무 목록',
  })
  await expect(allMissions.getByRole('heading')).toHaveCount(6)
  await picker
    .getByLabel('회사별 일정', { exact: true })
    .selectOption('blue_origin')
  await expect(allMissions).toContainText('March 2027')
  await expect(allMissions).toContainText('출발 일자 미정')
  await expect(
    allMissions.getByRole('button', { name: /출발일로 선택/ }),
  ).toHaveCount(0)
  await picker
    .getByLabel('회사별 일정', { exact: true })
    .selectOption('lockheed_martin')
  await expect(allMissions).toContainText(
    '두 사이트에 등록된 달 임무 일정 없음',
  )
  await expect(landing).toHaveValue('2027-01-12')
  await expect(
    picker.locator('option[value="blue-moon-pathfinder"]'),
  ).toBeDisabled()
  await expect(
    picker.getByLabel('선택한 발사 임무 출처').getByRole('link'),
  ).toHaveAttribute(
    'href',
    'https://www.spacelaunchschedule.com/launch/falcon-heavy-griffin-mission-one/',
  )
})
