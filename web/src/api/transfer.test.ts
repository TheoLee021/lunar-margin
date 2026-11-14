import { describe, expect, it } from 'vitest'
import { fetchTransfer } from './transfer'

const datedResponse = {
  departure: '2027-01-13T00:00:00Z',
  arrival: '2027-01-17T00:00:00Z',
  model: 'API contract fixture',
  earth_radius_km: 6378.1363,
  moon_radius_km: 1737.4,
  plane_x: [1, 0, 0],
  plane_y: [0, 1, 0],
  capture_plane_x: [1, 0, 0],
  capture_plane_y: [0, 1, 0],
  metrics: {
    travel_time_days: 4,
    parking_orbit_altitude_km: 200,
    arrival_altitude_km: 100,
    arrival_position_error_km: 0.001,
    post_loi_min_altitude_km: 97,
    tli_delta_v_km_s: 3.4,
    loi_delta_v_km_s: 1.7,
    total_impulsive_delta_v_km_s: 5.1,
  },
  transfer: [
    {
      seconds: 0,
      spacecraft_km: [6578.1363, 0, 0],
      moon_km: [300000, 200000, 0],
    },
    {
      seconds: 345600,
      spacecraft_km: [382562.6, 0, 0],
      moon_km: [384400, 0, 0],
    },
  ],
  capture: [
    {
      seconds: 345600,
      spacecraft_km: [382562.6, 0, 0],
      moon_km: [384400, 0, 0],
    },
    {
      seconds: 396000,
      spacecraft_km: [384400, 1837.4, 0],
      moon_km: [384400, 0, 0],
    },
  ],
  moon_orbit_km: [
    [300000, 200000, 0],
    [384400, 0, 0],
  ],
}

describe('dated trajectory API client', () => {
  it('accepts a valid computed interval matching the selected dates', async () => {
    const data = await fetchTransfer('2027-01-13', '2027-01-17', {
      fetchFn: async () => new Response(JSON.stringify(datedResponse)),
    })
    expect(data.arrival).toBe('2027-01-17T00:00:00Z')
    expect(data.metrics.travel_time_days).toBe(4)
  })
  it('sends the selected UTC dates and rejects a response for another interval', async () => {
    const calls: string[] = []
    await expect(
      fetchTransfer('2027-01-06', '2027-01-10', {
        fetchFn: async (url) => {
          calls.push(url)
          return new Response(JSON.stringify(datedResponse), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      }),
    ).rejects.toThrow('Trajectory does not match the selected dates')
    const url = new URL(calls[0]!, 'http://localhost')
    expect(url.pathname).toBe('/api/trajectory/transfer')
    expect(url.searchParams.get('departure')).toBe('2027-01-06T00:00:00Z')
    expect(url.searchParams.get('arrival')).toBe('2027-01-10T00:00:00Z')
  })
})
