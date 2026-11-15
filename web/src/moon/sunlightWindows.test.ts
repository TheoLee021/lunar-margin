import { describe, expect, it } from 'vitest'
import type { Vector3 } from './sun'
import type { SunlightMap } from './sunlightMap'
import {
  createSunlightWindows,
  type LoadedSunlightWindow,
  type SunlightWindowAddress,
} from './sunlightWindows'

// The 5 m level with one regional DEM (docs/api.md, Tiles). Its tiles x 83..95, y 100..112 cover
// x -45.3..-28.6 km, y 6.9..23.5 km; pixel (col, row) is at x = (col - 30300) * 5, y = (30300 - row) * 5.
const level = {
  z: 4,
  pixel_size_m: 5,
  size_px: 60601,
  center_px: 30300,
  tile_px: 256,
  tiles_per_side: 237,
  tile_ranges: [[83, 100, 95, 112] as [number, number, number, number]],
}
// Pixel (22900, 27300): tile (89.45, 106.64), so the 4x4 window around it starts at tile (87, 105).
const inRegion = { x: -37_000, y: 15_000 }
const sun: Vector3 = [0.8, 0.6, -0.03]
const side = 4 * 256
const map: SunlightMap = { width: side, height: side, data: new Uint8Array(0) }

// Every update is a camera check; the window is asked for once the same one has been wanted for
// SETTLE_MS. `settle` is two checks that far apart, as when the camera has come to rest.
const SETTLE_MS = 400

function setup() {
  let now = 0
  const asked: { address: SunlightWindowAddress; sun: Vector3 }[] = []
  const answers: {
    resolve: (map: SunlightMap) => void
    reject: (error: Error) => void
  }[] = []
  const shown: (LoadedSunlightWindow | null)[] = []
  const windows = createSunlightWindows({
    levels: [level],
    minTexelPx: 0.5,
    settleMs: SETTLE_MS,
    now: () => now,
    signal: new AbortController().signal,
    load: (address, direction) => {
      asked.push({ address, sun: direction })
      return new Promise((resolve, reject) => answers.push({ resolve, reject }))
    },
    onWindow: (slot, window) => {
      expect(slot).toBe(0)
      shown.push(window)
    },
  })
  const settle = (
    focus: { x: number; y: number },
    footprintM: number,
    direction: Vector3 | null,
  ) => {
    windows.update(focus, footprintM, direction)
    now += SETTLE_MS
    windows.update(focus, footprintM, direction)
  }
  const advance = (ms: number) => {
    now += ms
  }
  return { windows, settle, advance, asked, answers, shown }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createSunlightWindows', () => {
  it('asks for the window around the focus once the texels are large enough on screen', async () => {
    const { settle, asked, answers, shown } = setup()

    // 20 m of ground per screen pixel: a 5 m texel is a quarter of a pixel, too small to show
    settle(inRegion, 20, sun)
    expect(asked).toEqual([])

    // 8 m per screen pixel: 0.625 px per texel
    settle(inRegion, 8, sun)
    expect(asked).toEqual([{ address: { z: 4, tileX: 87, tileY: 105 }, sun }])

    answers[0]!.resolve(map)
    await settled()
    expect(shown).toEqual([{ level, origin: { tileX: 87, tileY: 105 }, map }])
  })

  it('does not ask again while the focus stays inside the window', () => {
    const { settle, asked } = setup()

    settle(inRegion, 8, sun)
    settle({ x: inRegion.x + 500, y: inRegion.y - 500 }, 8, sun)
    settle(inRegion, 3, [...sun])

    expect(asked).toHaveLength(1)
  })

  it('asks for the next window when the focus nears the edge', () => {
    const { settle, asked } = setup()

    settle(inRegion, 8, sun)
    // 2 km to the right is 400 px: past the last tile of the 1024 px window
    settle({ x: inRegion.x + 2_000, y: inRegion.y }, 8, sun)

    expect(asked.map(({ address }) => address)).toEqual([
      { z: 4, tileX: 87, tileY: 105 },
      { z: 4, tileX: 89, tileY: 105 },
    ])
  })

  it('waits for the camera to come to rest before asking', () => {
    const { windows, advance, asked } = setup()

    // A flight across the region: every check wants another window. The backend cannot stop a
    // computation once asked, so windows passed on the way would only hold up the one that counts.
    for (let step = 0; step < 6; step++) {
      windows.update({ x: inRegion.x + step * 1_500, y: inRegion.y }, 8, sun)
      advance(150)
    }
    expect(asked).toEqual([])

    // At rest over the last one.
    const rest = { x: inRegion.x + 7_500, y: inRegion.y }
    windows.update(rest, 8, sun)
    advance(150)
    windows.update(rest, 8, sun)
    expect(asked).toEqual([])
    advance(250)
    windows.update(rest, 8, sun)
    expect(asked.map(({ address }) => address)).toEqual([
      { z: 4, tileX: 93, tileY: 105 },
    ])
  })

  it('asks for nothing where the level has no tiles', () => {
    const { settle, asked } = setup()

    settle({ x: 0, y: 0 }, 8, sun)

    expect(asked).toEqual([])
  })

  it('takes the window down when the Sun moves and asks for the new Sun', async () => {
    const { settle, asked, answers, shown } = setup()
    const later: Vector3 = [0.6, 0.8, -0.03]
    settle(inRegion, 8, sun)
    answers[0]!.resolve(map)
    await settled()

    settle(inRegion, 8, later)

    expect(shown.at(-1)).toBeNull()
    expect(asked.at(-1)).toEqual({
      address: { z: 4, tileX: 87, tileY: 105 },
      sun: later,
    })
  })

  it('ignores a window that arrives after the Sun has moved on', async () => {
    const { settle, answers, shown } = setup()
    settle(inRegion, 8, sun)

    settle(inRegion, 8, null)
    answers[0]!.resolve(map)
    await settled()

    expect(shown.every((window) => window === null)).toBe(true)
  })

  it('does not ask again for a window that failed, or show one of the wrong size', async () => {
    const { settle, asked, answers, shown } = setup()
    settle(inRegion, 8, sun)
    answers[0]!.reject(new Error('GET failed with 503'))
    await settled()
    settle(inRegion, 8, sun)
    expect(asked).toHaveLength(1)

    settle({ x: inRegion.x + 2_000, y: inRegion.y }, 8, sun)
    answers[1]!.resolve({ width: 512, height: 512, data: new Uint8Array(0) })
    await settled()

    expect(shown).toEqual([])
  })
})
