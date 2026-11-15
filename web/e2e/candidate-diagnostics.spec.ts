import { expect, test } from '@playwright/test'
import { z } from 'zod'

const Fixture = z.looseObject({
  candidates: z.array(z.looseObject({ id: z.string() })),
})

const STUB = process.env.STUB_URL ?? 'http://localhost:8765'

test('candidate detail separates degree clearance from saved RF dB and retries diagnostics', async ({
  page,
  request,
}) => {
  const response = await request.get(`${STUB}/candidates/runs/synthetic`)
  expect(response.ok()).toBe(true)
  const run = Fixture.parse(await response.json())
  const rf = {
    fraction: 0.8,
    longest_blackout_hours: 6,
    min_link_margin_db: 15.688618,
    required_ebn0_db: 0.745886,
    rx_required_dbw: -144.144136,
    evaluation_hours: 24,
    available_hours: 19.2,
  }
  run.candidates = run.candidates.map((candidate) => ({ ...candidate, rf }))
  await page.route('**/api/**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(/^https?:\/\/[^/]+\/api/, STUB),
    }),
  )
  await page.route('**/api/candidates/runs/synthetic', (route) =>
    route.fulfill({ json: run }),
  )
  let failDiagnostics = true
  await page.route('**/api/analysis/site-assessment?**', async (route) => {
    if (failDiagnostics) {
      await route.fulfill({
        status: 503,
        json: { detail: 'diagnostic retry example' },
      })
      return
    }
    const q = new URL(route.request().url()).searchParams
    await route.fulfill({
      json: {
        lat: Number(q.get('lat')),
        lon: Number(q.get('lon')),
        start: q.get('start'),
        end: q.get('end'),
        step_minutes: Number(q.get('step_minutes')),
        observer_height_m: Number(q.get('observer_height_m')),
        sun: {
          visible_fraction: 0.5,
          longest_dark_hours: 1,
          windows_per_24h: 1,
          mean_elevation_deg: 1,
        },
        earth: {
          visible_fraction: 0.5,
          longest_dark_hours: 1,
          windows_per_24h: 1,
          mean_elevation_deg: 1,
        },
        terrain: {
          slope_p95_deg: 1,
          coverage_fraction: 1,
          assessment_radius_m: 250,
          slope_baseline_m: 160,
          roughness_window_m: 400,
          dem_pixel_m: 80,
          landing_safety_status: 'UNVERIFIED',
        },
        terrain_clearance: {
          sun_visible_p10_deg: 0.123,
          earth_visible_p10_deg: null,
        },
        solar_continuity: {
          longest_sun_visible_hours: 1 / 6,
          visibility_transitions: 0,
        },
      },
    })
  })
  await page.goto('/?view=search&run=synthetic')
  await page
    .getByRole('table')
    .getByRole('button', { name: /SP500_/ })
    .first()
    .click()
  const panel = page.getByRole('region', { name: '후보 일조·지형 여유각 진단' })
  await expect(panel).toContainText('상세 진단을 불러오지 못했습니다')
  await expect(panel).toContainText('15.69 dB')
  failDiagnostics = false
  await panel.getByRole('button', { name: '상세 진단 다시 시도' }).click()
  await expect(panel).toContainText('0.123°')
  await expect(panel).toContainText('가시 구간 없음')
  await expect(panel).toContainText('10분')
  await expect(panel).toContainText('0회')
  await expect(panel).toContainText('지형 여유각(°)을 dB로 환산하지 않습니다')
})
