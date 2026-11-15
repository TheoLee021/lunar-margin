import { describe, expect, it } from 'vitest'
import { greyChannel, loadSunlightMap, sunlightMapUrl } from './sunlightMap'

describe('sunlightMapUrl', () => {
  it('asks for the map of one Sun direction (docs/api.md, Sunlight)', () => {
    const url = new URL(
      sunlightMapUrl('https://api.example/base', [0.6, -0.8, 0.0125]),
    )

    expect(url.pathname).toBe('/base/sunlight/south-pole.png')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      x: '0.6',
      y: '-0.8',
      z: '0.0125',
    })
  })
})

describe('greyChannel', () => {
  it('keeps one byte per pixel, row by row', () => {
    // 2x2 grey RGBA image: 10, 200 / 0, 255
    const rgba = Uint8Array.from([
      10, 10, 10, 255, 200, 200, 200, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ])

    const grey = greyChannel({ width: 2, height: 2, data: rgba })

    expect(Array.from(grey)).toEqual([10, 200, 0, 255])
  })
})

// 백엔드 인코더로 만든 2x2 RGBA PNG (overlayTiles.test.ts와 같은 것). R 채널: 10, 200 / 1, 0
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4nGPgEpFjOJFi9J+BkYmZhQEIAB7uAqRpT1clAAAAAElFTkSuQmCC',
  ),
  (char) => char.charCodeAt(0),
)

describe('loadSunlightMap', () => {
  const busy = () =>
    new Response('busy', { status: 429, headers: { 'Retry-After': '7' } })
  const ok = () => new Response(PNG, { status: 200 })

  it('waits as long as a busy server asks and then tries again', async () => {
    const responses = [busy(), busy(), ok()]
    const waits: number[] = []

    const map = await loadSunlightMap(
      [1, 0, 0],
      '/api',
      new AbortController().signal,
      {
        fetchFn: () => Promise.resolve(responses.shift()!),
        wait: (ms) => {
          waits.push(ms)
          return Promise.resolve()
        },
      },
    )

    expect(Array.from(map.data)).toEqual([10, 200, 1, 0])
    expect(waits).toEqual([7000, 7000])
  })

  it('gives up when the server stays busy', async () => {
    let calls = 0

    await expect(
      loadSunlightMap([1, 0, 0], '/api', new AbortController().signal, {
        fetchFn: () => {
          calls++
          return Promise.resolve(busy())
        },
        wait: () => Promise.resolve(),
      }),
    ).rejects.toThrow('429')
    expect(calls).toBe(6) // the first try and five more
  })

  it('does not retry other failures', async () => {
    let calls = 0

    await expect(
      loadSunlightMap([1, 0, 0], '/api', new AbortController().signal, {
        fetchFn: () => {
          calls++
          return Promise.resolve(new Response('no data', { status: 503 }))
        },
        wait: () => Promise.resolve(),
      }),
    ).rejects.toThrow('503')
    expect(calls).toBe(1)
  })
})
