import type { Page } from '@playwright/test'

/** Synthetic flights for workflows that compare five explicitly available departure days. */
export async function mockScheduledDepartures(page: Page) {
  await page.route('**/api/pricing/providers/launches', (route) =>
    route.fulfill({
      json: {
        timezone: 'UTC',
        sources: [],
        launches: [4, 5, 6, 7, 8].map((day) => ({
          id: `fixture-flight-${day}`,
          provider_id: 'blue_origin',
          launch_provider: 'Blue Origin',
          name: `Fixture flight ${day}`,
          departure_date: `2027-01-0${day}`,
          label: `January ${day}`,
          confirmed: false,
          date_precision: 'day',
          sources: [
            {
              name: 'Test schedule',
              url: 'https://example.com/launches',
              label: `January ${day}`,
            },
          ],
        })),
      },
    }),
  )
}
