import { describe, expect, it } from 'vitest'
import { fetchSunDirection, fetchSunDirections } from './sunlight'

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

// docs/api.md 의 예시 응답
const path = {
  start: '2027-01-10T00:00:00Z',
  end: '2027-01-10T01:00:00Z',
  step_minutes: 30,
  directions: [
    [-0.894677, 0.446459, -0.01511],
    [-0.89269, 0.450419, -0.015103],
  ],
}

describe('fetchSunDirections', () => {
  const range = { start: path.start, end: path.end, stepMinutes: 30 }

  it('asks for the Sun directions of a range and returns one vector per sample', async () => {
    const { urls, fetchFn } = respondWith(path)

    const sunPath = await fetchSunDirections(range, undefined, {
      baseUrl: '/api',
      fetchFn,
    })

    expect(sunPath).toEqual({
      start: '2027-01-10T00:00:00Z',
      stepMinutes: 30,
      directions: path.directions,
    })
    expect(urls).toEqual([
      '/api/sunlight/sun-directions?start=2027-01-10T00%3A00%3A00Z&end=2027-01-10T01%3A00%3A00Z&step_minutes=30',
    ])
  })

  it('rejects a response that is not the range that was asked for', async () => {
    for (const body of [
      { ...path, directions: [] },
      { ...path, directions: [[1, 0], path.directions[1]] },
      { ...path, directions: [[0, 0, 0], path.directions[1]] },
      { ...path, directions: [path.directions[0]] }, // one sample short
      { ...path, start: '2027-01-11T00:00:00Z', end: '2027-01-11T01:00:00Z' },
      { ...path, step_minutes: 60 },
    ]) {
      const { fetchFn } = respondWith(body)
      await expect(
        fetchSunDirections(range, undefined, { baseUrl: '/api', fetchFn }),
      ).rejects.toThrow()
    }
  })

  it('reports the status when the backend has no ephemeris data', async () => {
    const { fetchFn } = respondWith({ detail: 'missing SPICE kernel' }, 503)

    await expect(
      fetchSunDirections(range, undefined, { baseUrl: '/api', fetchFn }),
    ).rejects.toThrow('503')
  })
})
