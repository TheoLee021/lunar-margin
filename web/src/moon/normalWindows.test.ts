import { describe, expect, it } from 'vitest'
import {
  composeWindow,
  polarXY,
  tilesOfWindow,
  windowOrigin,
  WINDOW_TILES,
} from './normalWindows'
import type { RgbaImage } from './overlayTiles'

// The documented 80 m level (docs/api.md, Tiles): pixel (col, row) is at
// x = (col - center_px) * pixel_size_m, y = (center_px - row) * pixel_size_m.
const level = {
  z: 2,
  pixel_size_m: 80,
  size_px: 3789,
  center_px: 1894,
  tile_px: 256,
  tiles_per_side: 15,
}

describe('polarXY', () => {
  it('puts the pole at the origin, longitude 0° up and longitude 90° to the right', () => {
    const pole = polarXY({ lat: -90, lon: 0 })
    const lon0 = polarXY({ lat: -89, lon: 0 })
    const lon90 = polarXY({ lat: -89, lon: 90 })

    expect(pole.x).toBeCloseTo(0, 6)
    expect(pole.y).toBeCloseTo(0, 6)
    // one degree of latitude on the Moon is 30.3 km; the projection stretches it by under 0.01% here
    expect(lon0.x).toBeCloseTo(0, 3)
    expect(lon0.y / 1000).toBeCloseTo(30.32, 1)
    expect(lon90.x / 1000).toBeCloseTo(30.32, 1)
    expect(lon90.y).toBeCloseTo(0, 3)
  })
})

describe('windowOrigin', () => {
  it('centres the window on the focus, aligned to whole tiles', () => {
    // the pole is pixel (1894, 1894): tile 7.4, so the nearest tile corner is 7
    expect(windowOrigin(level, { x: 0, y: 0 })).toEqual({ tileX: 5, tileY: 5 })
    // 40 km towards longitude 90° is 500 px to the right: tile 9.35 -> corner 9
    expect(windowOrigin(level, { x: 40_000, y: 0 })).toEqual({
      tileX: 7,
      tileY: 5,
    })
    // 40 km towards longitude 0° is 500 px up
    expect(windowOrigin(level, { x: 0, y: 40_000 })).toEqual({
      tileX: 5,
      tileY: 3,
    })
  })

  it('keeps the current window while the focus stays away from its edge', () => {
    const current = windowOrigin(level, { x: 0, y: 0 })
    // 12 km right moves the nearest tile corner from 7 to 8, but the focus is still a full tile
    // away from the window edge, so reloading would only cause flicker
    expect(windowOrigin(level, { x: 12_000, y: 0 }, current)).toEqual(current)
    // 40 km right is past the edge: recentre
    expect(windowOrigin(level, { x: 40_000, y: 0 }, current)).toEqual({
      tileX: 7,
      tileY: 5,
    })
  })
})

describe('tilesOfWindow', () => {
  it('lists the tiles row by row and leaves out those beyond the level', () => {
    const inside = tilesOfWindow(level, { tileX: 5, tileY: 5 })
    expect(inside).toHaveLength(WINDOW_TILES * WINDOW_TILES)
    expect(inside[0]).toEqual({ x: 5, y: 5, slotX: 0, slotY: 0 })
    expect(inside[1]).toEqual({ x: 6, y: 5, slotX: 1, slotY: 0 })
    expect(inside[WINDOW_TILES]).toEqual({ x: 5, y: 6, slotX: 0, slotY: 1 })

    // a window hanging over the top-left corner of the level only has its lower-right tiles
    const corner = tilesOfWindow(level, { tileX: -2, tileY: -3 })
    expect(corner.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [1, 0],
    ])
    expect(corner[0]).toMatchObject({ slotX: 2, slotY: 3 })
  })

  it('on a sparse level keeps only the tiles inside its ranges', () => {
    // two regions: tiles x 6..7, y 5..5 and the single tile (8, 8)
    const sparse = {
      ...level,
      tile_ranges: [
        [6, 5, 7, 5],
        [8, 8, 8, 8],
      ] as [number, number, number, number][],
    }

    const tiles = tilesOfWindow(sparse, { tileX: 5, tileY: 5 })

    expect(tiles.map(({ x, y }) => [x, y])).toEqual([
      [6, 5],
      [7, 5],
      [8, 8],
    ])
    expect(tilesOfWindow(sparse, { tileX: 0, tileY: 0 })).toEqual([])
  })
})

describe('composeWindow', () => {
  const tiny = { ...level, tile_px: 2, tiles_per_side: 8 }
  const tile = (...pixels: number[][]): RgbaImage => ({
    width: 2,
    height: 2,
    data: Uint8Array.from(pixels.flat()),
  })
  const size = WINDOW_TILES * 2
  const pixel = (image: RgbaImage, col: number, row: number) =>
    Array.from(
      image.data.subarray((row * size + col) * 4, (row * size + col) * 4 + 4),
    )

  it('places each tile in its slot, first row first', () => {
    const image = composeWindow(tiny, [
      {
        slotX: 1,
        slotY: 0,
        image: tile([1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3], [4, 4, 4, 4]),
      },
    ])

    expect([image.width, image.height]).toEqual([size, size])
    expect(pixel(image, 2, 0)).toEqual([1, 1, 1, 1])
    expect(pixel(image, 3, 0)).toEqual([2, 2, 2, 2])
    expect(pixel(image, 2, 1)).toEqual([3, 3, 3, 3])
    expect(pixel(image, 3, 1)).toEqual([4, 4, 4, 4])
  })

  it('leaves slots without a tile as no data', () => {
    // all-zero bytes mean "no data" (docs/api.md); the shader falls back to a coarser level there
    const image = composeWindow(tiny, [
      {
        slotX: 0,
        slotY: 0,
        image: tile([9, 9, 9, 9], [0, 0, 0, 0], [0, 0, 0, 7], [9, 9, 9, 9]),
      },
    ])

    expect(pixel(image, 1, 0)).toEqual([0, 0, 0, 0]) // no-data pixel inside a tile
    expect(pixel(image, 0, 1)).toEqual([0, 0, 0, 7])
    expect(pixel(image, 5, 5)).toEqual([0, 0, 0, 0]) // slot with no tile
  })

  it('rejects a tile of the wrong size', () => {
    expect(() =>
      composeWindow(level, [{ slotX: 0, slotY: 0, image: tile([1, 1, 1, 1]) }]),
    ).toThrow()
  })
})
