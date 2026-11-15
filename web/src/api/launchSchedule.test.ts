import { expect, test } from 'vitest'
import { fetchLaunchSchedule } from './launchSchedule'

test('launch response rejects impossible dates and leaves month-only dates unselectable', async () => {
  const payload = {
    timezone: 'UTC',
    sources: [],
    launches: [
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
            url: 'https://www.spacelaunchschedule.com/',
            label: 'March 2027',
          },
        ],
      },
    ],
  }
  const result = await fetchLaunchSchedule({
    fetchFn: async () => Response.json(payload),
  })
  expect(result.launches[0]?.departure_date).toBeNull()
  await expect(
    fetchLaunchSchedule({
      fetchFn: async () =>
        Response.json({
          ...payload,
          launches: [{ ...payload.launches[0], departure_date: '2027-02-30' }],
        }),
    }),
  ).rejects.toThrow('응답 형식')
})

test('departure availability requires an exact published day and respects the selected flight', async () => {
  const { departureAvailability, LaunchScheduleSchema } =
    await import('./launchSchedule')
  const source = {
    name: 'Schedule',
    url: 'https://example.com/',
    label: 'January',
  }
  const data = LaunchScheduleSchema.parse({
    timezone: 'UTC',
    sources: [],
    launches: [
      {
        id: 'jan6',
        provider_id: 'spacex',
        name: 'First',
        departure_date: '2027-01-06',
        label: 'Jan 6',
        confirmed: false,
        sources: [source],
      },
      {
        id: 'jan7',
        provider_id: 'blue_origin',
        name: 'Second',
        departure_date: '2027-01-07',
        label: 'Jan 7',
        confirmed: false,
        sources: [source],
      },
      {
        id: 'month',
        provider_id: 'spacex',
        name: 'TBD',
        departure_date: null,
        label: 'January 2027',
        confirmed: false,
        sources: [source],
      },
    ],
  })
  expect(departureAvailability(data, '', null, '2027-01-06')).toBe('scheduled')
  expect(departureAvailability(data, '', null, '2027-01-05')).toBe('no_launch')
  expect(departureAvailability(data, '', 'jan6', '2027-01-07')).toBe(
    'no_launch',
  )
  expect(departureAvailability(data, '', 'month', '2027-01-06')).toBe('unknown')
  expect(departureAvailability(data, '', 'missing', '2027-01-06')).toBe(
    'unknown',
  )
  expect(departureAvailability(null, '', null, '2027-01-06')).toBe('loading')
  expect(departureAvailability(null, '503', null, '2027-01-06')).toBe('unknown')
  expect(
    departureAvailability(
      {
        ...data,
        launches: [],
        sources: [
          {
            name: 'Schedule',
            url: 'https://example.com/',
            fetched_at: '2026-11-15T09:00:00Z',
            stale: false,
            error: null,
            scanned_records: 0,
            scanned_pages: 1,
            complete: false,
          },
        ],
      },
      '',
      null,
      '2027-01-06',
    ),
  ).toBe('unknown')
})
