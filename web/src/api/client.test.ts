import { describe, expect, it } from 'vitest'
import { fetchHealth } from './client'

function fakeFetch(body: unknown, init: ResponseInit = { status: 200 }) {
  return () => Promise.resolve(new Response(JSON.stringify(body), init))
}

describe('fetchHealth', () => {
  it('parses a valid health response', async () => {
    const result = await fetchHealth({
      baseUrl: '/api',
      fetchFn: fakeFetch({ status: 'ok' }),
    })
    expect(result).toEqual({ status: 'ok' })
  })

  it('throws ApiError on non-2xx response', async () => {
    await expect(
      fetchHealth({
        baseUrl: '/api',
        fetchFn: fakeFetch({ detail: 'down' }, { status: 503 }),
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 503 })
  })

  it('throws ApiError when the response does not match the schema', async () => {
    await expect(
      fetchHealth({ baseUrl: '/api', fetchFn: fakeFetch({ status: 'nope' }) }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 200 })
  })
})
