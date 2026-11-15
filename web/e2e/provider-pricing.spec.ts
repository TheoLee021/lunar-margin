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
            id: 'amazon-demo',
            provider_id: null,
            launch_provider: 'United Launch Alliance (ULA)',
            lunar_related: false,
            name: 'Amazon Leo (LV-01)',
            departure_date: '2026-11-15',
            label: 'November 15',
            confirmed: false,
            sources: [
              {
                name: 'Spaceflight Now',
                url: 'https://spaceflightnow.com/launch-schedule/',
                label: 'November 15',
              },
            ],
          },
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
    name: '전체 발사 일정 목록',
  })
  await expect(allMissions.getByRole('heading')).toHaveCount(7)
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
  await expect(allMissions).toContainText('두 사이트에 등록된 발사 일정 없음')
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
  await picker.getByLabel('회사별 일정', { exact: true }).selectOption('other')
  await picker.getByLabel('임무·발사사 검색', { exact: true }).fill('Amazon')
  await expect(allMissions).toContainText('일반 발사 · 데모')
  await allMissions
    .getByRole('button', {
      name: 'Amazon Leo (LV-01) 2026-11-15 출발일로 선택',
    })
    .click()
  await expect(
    page.getByLabel('기준 출발일 · UTC', { exact: true }),
  ).toHaveValue('2026-11-15')
  await expect(landing).toHaveValue('2027-01-12')
})

test('selected launch operator reprices the same date and grids and survives navigation', async ({
  page,
}) => {
  const launches = [
    {
      id: 'spacex-demo',
      provider_id: 'spacex',
      launch_provider: 'SpaceX',
      name: 'Falcon demo',
    },
    {
      id: 'ula-demo',
      provider_id: null,
      launch_provider: 'United Launch Alliance (ULA)',
      name: 'Amazon demo',
    },
  ].map((l) => ({
    ...l,
    lunar_related: false,
    departure_date: '2027-01-06',
    label: 'January 6',
    confirmed: false,
    sources: [
      {
        name: 'Spaceflight Now',
        url: 'https://spaceflightnow.com/launch-schedule/',
        label: 'January 6',
      },
    ],
  }))
  await page.route('**/api/pricing/providers/launches', (route) =>
    route.fulfill({ json: { timezone: 'UTC', sources: [], launches } }),
  )
  let requests = 0
  await page.route('**/api/pricing/providers/calendar', (route) => {
    const input = route.request().postDataJSON() as {
      selected_launch_id: string | null
      mass_kg: number
      delivery: string
      mission: { mission_duration_days: number }
      landing_dates: string[]
      departure_dates: string[]
    }
    requests++
    const launch = launches.find((l) => l.id === input.selected_launch_id)
    const rate = launch?.provider_id === 'spacex' ? 100000 : 1200000
    const mean = launch ? 500000 + rate * input.mass_kg : 2000000
    return route.fulfill({
      json: {
        estimate: true,
        selection: launch
          ? {
              launch_id: launch.id,
              launch_name: launch.name,
              company_id: launch.provider_id,
              company_name: launch.launch_provider,
              tariff_usd_per_kg: rate,
              fixed_usd: 500000,
              billable_mass_kg: input.mass_kg,
              tariff_basis: launch.provider_id
                ? 'public_tariff'
                : 'common_model',
              tariff_source: {
                title: 'Demo reference',
                url: 'https://example.com/',
                published_date: null,
              },
              assumptions: ['실제 발사 임무와의 연계 미확인'],
            }
          : null,
        catalog_checked_on: '2026-11-15',
        mass_kg: input.mass_kg,
        delivery: input.delivery,
        mission_duration_days: input.mission.mission_duration_days,
        aggregation: 'mean_of_grid_minima',
        sampling: 'all_eligible_500m_grids',
        dates: input.landing_dates.map((l) => ({
          landing_date: l,
          run_id: `saved-${l}`,
          state: 'completed',
          message: null,
        })),
        cells: input.landing_dates.flatMap((l) =>
          input.departure_dates.map((d) => ({
            departure_date: d,
            landing_date: l,
            run_id: `saved-${l}`,
            status: 'estimated',
            mean_min_usd: mean,
            eligible_grid_count: 110,
            quoted_grid_count: 110,
            eligible_provider_ids: launch
              ? launch.provider_id
                ? [launch.provider_id]
                : []
              : ['blue_origin'],
          })),
        ),
      },
    })
  })
  await page.goto(
    '/?planner=1&departure=2027-01-06&arrival=2027-01-10&duration=14',
  )
  const dialog = page.getByRole('dialog')
  const picker = dialog.getByLabel('발사 일정에서 출발일 선택 · UTC')
  const model = dialog.getByRole('region', {
    name: '선택한 발사사의 가격 모델',
  })
  const table = dialog.getByRole('table', {
    name: '출발일과 착륙일별 평균 가격',
  })
  await picker.selectOption('spacex-demo')
  await expect(model).toContainText('SpaceX 모델 예상 비용')
  await expect(table.getByText('$2.9M', { exact: true })).toHaveCount(19)
  await expect(
    table.getByRole('link', { name: /2027-01-06.*2027-01-10/ }),
  ).toHaveAttribute('href', /launch_id=spacex-demo/)
  const before = requests
  await picker.selectOption('ula-demo')
  await expect(model).toContainText(
    'United Launch Alliance (ULA) 모델 예상 비용',
  )
  await expect(model).toContainText('공통 참조 단가')
  await expect(table.getByText('$29M', { exact: true })).toHaveCount(19)
  expect(requests).toBeGreaterThan(before)
  await expect(
    dialog.getByLabel('기준 착륙일 · UTC', { exact: true }),
  ).toHaveValue('2027-01-10')
  await picker.selectOption('')
  await expect(model).toHaveCount(0)
  await expect(table.getByText('$2M', { exact: true })).toHaveCount(19)
  await picker.selectOption('spacex-demo')
  await expect(model).toContainText('SpaceX 모델 예상 비용')
  await dialog.getByRole('button', { name: '일정 적용' }).click()
  await expect(page).toHaveURL(/launch_id=spacex-demo/)
  await page.reload()
  await page.getByRole('button', { name: '미션 날짜 비교 열기' }).click()
  await expect(picker).toHaveValue('spacex-demo')
  await expect(model).toContainText('SpaceX 모델 예상 비용')
})
