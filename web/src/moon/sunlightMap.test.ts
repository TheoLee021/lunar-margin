import { describe, expect, it } from 'vitest'
import { greyChannel, sunlightMapUrl } from './sunlightMap'

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
