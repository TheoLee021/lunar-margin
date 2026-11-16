import { expect, test } from '@playwright/test'

// 실제 Postgres + API 필요. docs/reservations.md로 DB/임무 실행을 준비한다.
test('visitors confirm, view history, and cancel without a token', async ({
  page,
  request,
}) => {
  const company = `E2E-${Date.now()}`
  let bookingId: string | null = null
  try {
    await page.goto('/')
    await page.getByRole('button', { name: '후보지 탐색', exact: true }).click()
    const table = page.getByRole('table')
    const row = table
      .locator('tbody tr')
      .filter({ hasText: '예약 가능' })
      .first()
    await expect(row).toBeVisible()
    const candidateButton = row.getByRole('button')
    const candidateId = await candidateButton.innerText()
    await candidateButton.click()
    await page.getByText('예약 관리', { exact: true }).click()
    await expect(page.getByLabel('운영자 토큰')).toHaveCount(0)
    await expect(page.getByText(/공개 데모로 누구나/)).toBeVisible()
    await page.getByLabel('회사명', { exact: true }).fill(company)
    await page.getByLabel('임무명', { exact: true }).fill('Reservation test')
    await page.getByRole('button', { name: '선택 격자 예약 확정' }).click()
    await expect(page.getByText(/예약을 확정했습니다/)).toBeVisible()
    const listResponse = await request.get('/api/reservations')
    expect(listResponse.ok()).toBe(true)
    const list: {
      reservations: {
        id: string
        company: string
        cell_ix: number
        cell_iy: number
        starts_at: string
        ends_at: string
      }[]
    } = await listResponse.json()
    const record = list.reservations.find(
      (booking) => booking.company === company,
    )
    if (!record) throw new Error('Confirmed booking disappeared')
    bookingId = record.id
    const reservedRow = table.locator('tbody tr').filter({
      has: page.getByRole('button', { name: candidateId, exact: true }),
    })
    await expect(reservedRow).toContainText('예약됨 · 예약 불가')
    await expect(reservedRow).toContainText(company)
    await expect(
      page.getByRole('button', { name: '선택 격자 예약 확정' }),
    ).toBeDisabled()
    // 다른 호출자도 화면의 비활성 버튼을 우회해 중복 예약할 수 없다.
    const conflict = await request.post('/api/reservations', {
      data: {
        company: 'Other',
        mission_name: 'Overlap',
        cell_ix: record.cell_ix,
        cell_iy: record.cell_iy,
        landing_date: record.starts_at.slice(0, 10),
        mission_duration_days: 1,
      },
    })
    expect(conflict.status()).toBe(409)
    await page
      .getByRole('region', { name: '후보 목록' })
      .screenshot({ path: 'test-results/reservation-confirmed.png' })
    await page.getByRole('button', { name: '예약 이력 조회' }).click()
    await page
      .getByRole('button', {
        name: `${company} Reservation test 예약 취소`,
        exact: true,
      })
      .click()
    await expect(reservedRow).toContainText('예약 가능')
    await expect(
      page
        .getByLabel('예약 이력')
        .getByText(`${company} · Reservation test · 취소됨`),
    ).toBeVisible()
    await page.reload()
    await expect(
      page
        .getByRole('table')
        .locator('tbody tr')
        .filter({ hasText: candidateId }),
    ).toContainText('예약 가능')
  } finally {
    if (bookingId) await request.post(`/api/reservations/${bookingId}/cancel`)
  }
})

test('availability failures stay visibly unknown and cannot be confirmed', async ({
  page,
}) => {
  await page.route('**/api/candidates/runs/*/availability', (route) =>
    route.fulfill({ status: 503, json: { detail: '예약 저장소 연결 실패' } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '후보지 탐색', exact: true }).click()
  await expect(
    page.getByText(/예약 확인 불가 · 예약 확정이 차단/),
  ).toBeVisible()
  await expect(
    page.getByRole('table').locator('tbody tr').first(),
  ).toContainText('미확인 · 예약 불가')
  await page.getByText('예약 관리', { exact: true }).click()
  await expect(
    page.getByRole('button', { name: '선택 격자 예약 확정' }),
  ).toBeDisabled()
})
