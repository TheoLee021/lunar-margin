import { describe, expect, it } from 'vitest'
import { fetchSunDirection } from './sunlight'

// docs/api.md 의 예시 응답
const sample = {
  time: '2027-01-10T00:00:00Z',
  x: -0.894677,
  y: 0.446459,
  z: -0.01511,
}

function respondWith(body: unknown, status = 200) {
  const urls: string[] = []
  const fetchFn = (url: string) => {
    urls.push(url)
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return { urls, fetchFn }
}

describe('fetchSunDirection', () => {
  it('asks for the Sun direction of one moment and returns it as a vector', async () => {
    const { urls, fetchFn } = respondWith(sample)

    const direction = await fetchSunDirection(
      '2027-01-10T00:00:00Z',
      undefined,
      { baseUrl: '/api', fetchFn },
    )

    expect(direction).toEqual([-0.894677, 0.446459, -0.01511])
    expect(urls).toEqual([
      '/api/sunlight/sun-direction?time=2027-01-10T00%3A00%3A00Z',
    ])
  })

  it('rejects a response that is not a direction', async () => {
    for (const body of [
      { ...sample, z: 'down' },
      { time: sample.time, x: 1, y: 0 },
      { ...sample, x: 0, y: 0, z: 0 },
    ]) {
      const { fetchFn } = respondWith(body)
      await expect(
        fetchSunDirection(sample.time, undefined, { baseUrl: '/api', fetchFn }),
      ).rejects.toThrow('unexpected shape')
    }
  })

  it('reports the status when the backend has no ephemeris data', async () => {
    const { fetchFn } = respondWith({ detail: 'missing SPICE kernel' }, 503)

    await expect(
      fetchSunDirection(sample.time, undefined, { baseUrl: '/api', fetchFn }),
    ).rejects.toThrow('503')
  })
})
