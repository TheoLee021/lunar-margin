import { describe, expect, it } from 'vitest'
import {
  decodeRgbaPng,
  HorizonMetaSchema,
  NormalMetaSchema,
  NormalWideMetaSchema,
} from './overlayTiles'

// 백엔드 인코더(api/src/lunar_margin/pipeline/png.py)로 만든 2x2 RGBA PNG.
// 행 0: (10,20,30,0) (200,100,50,255), 행 1: (1,2,3,4) (0,0,0,0)
const FIXTURE =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4nGPgEpFjOJFi9J+BkYmZhQEIAB7uAqRpT1clAAAAAElFTkSuQmCC'

const bytes = (base64: string) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

describe('decodeRgbaPng', () => {
  it('returns the exact bytes row by row, even where alpha is zero', async () => {
    const image = await decodeRgbaPng(bytes(FIXTURE))

    expect(image.width).toBe(2)
    expect(image.height).toBe(2)
    expect(Array.from(image.data)).toEqual([
      10, 20, 30, 0, 200, 100, 50, 255, 1, 2, 3, 4, 0, 0, 0, 0,
    ])
  })

  it('rejects data that is not a PNG', async () => {
    await expect(decodeRgbaPng(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})

const level = {
  z: 0,
  pixel_size_m: 500,
  size_px: 607,
  center_px: 303,
  tile_px: 607,
  tiles_per_side: 1,
}

describe('tile meta schemas', () => {
  it('accept the documented horizon and normal meta', () => {
    expect(
      HorizonMetaSchema.parse({
        version: 1,
        layer: 'horizon',
        levels: [level],
        encoding: {
          azimuth_step_deg: 5,
          azimuths: 72,
          atlas_cols: 6,
          atlas_rows: 3,
          offset_deg: -5,
          step_deg: 0.05,
        },
      }).levels[0]!.center_px,
    ).toBe(303)
    expect(
      NormalMetaSchema.parse({
        version: 1,
        layer: 'normal',
        levels: [level],
        encoding: { bias: 32768, scale: 16384 },
      }).encoding.scale,
    ).toBe(16384)
  })

  it('rejects a meta without levels or with another layer name', () => {
    expect(() =>
      NormalMetaSchema.parse({
        version: 1,
        layer: 'normal',
        levels: [],
        encoding: { bias: 32768, scale: 16384 },
      }),
    ).toThrow()
    expect(() =>
      NormalMetaSchema.parse({
        version: 1,
        layer: 'horizon',
        levels: [level],
        encoding: { bias: 32768, scale: 16384 },
      }),
    ).toThrow()
  })

  // docs/api.md, Tiles: the layer that carries the slopes out to 60°S in one image.
  const wide = {
    version: 1,
    layer: 'normal-wide',
    levels: [
      {
        z: 0,
        pixel_size_m: 960,
        size_px: 1941,
        center_px: 970,
        tile_px: 1941,
        tiles_per_side: 1,
      },
    ],
    encoding: { bias: 32768, scale: 16384 },
    sunlight: { pixel_size_m: 640, size_px: 2911, center_px: 1455 },
  }

  it('accept the documented normal-wide meta with the grid of its sunlight map', () => {
    const meta = NormalWideMetaSchema.parse(wide)

    expect(meta.levels[0]!.pixel_size_m).toBe(960)
    expect(meta.sunlight).toEqual({
      pixel_size_m: 640,
      size_px: 2911,
      center_px: 1455,
    })
  })

  it('rejects a normal-wide meta without its sunlight grid or with another layer name', () => {
    expect(() =>
      NormalWideMetaSchema.parse({ ...wide, sunlight: undefined }),
    ).toThrow()
    expect(() =>
      NormalWideMetaSchema.parse({ ...wide, layer: 'normal' }),
    ).toThrow()
    expect(() =>
      NormalWideMetaSchema.parse({
        ...wide,
        sunlight: { pixel_size_m: 0, size_px: 2911, center_px: 1455 },
      }),
    ).toThrow()
  })
})
