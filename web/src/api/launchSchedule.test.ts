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
