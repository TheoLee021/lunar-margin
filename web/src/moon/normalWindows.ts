// Fine normal levels (docs/api.md, Tiles) are too large to load whole: an 80 m level of the polar cap
// is some 50 MB. The shader instead reads, per level, one square "window" of WINDOW_TILES x WINDOW_TILES
// tiles around the point the camera looks at. This module picks that window, loads its tiles and
// assembles them into one image. No Cesium here.
import type { LunarLocation } from './location'
import { fetchTile, type RgbaImage, type TileLevel } from './overlayTiles'

/** Tiles along one side of a window: 1024 px with 256 px tiles, 82 km at 80 m per pixel. */
export const WINDOW_TILES = 4
// Decoded tiles kept for reuse when the window moves back and forth (256 px tiles: about 260 kB each).
const CACHED_TILES = 96
const MOON_RADIUS_M = 1_737_400
const RAD = Math.PI / 180

export interface PolarXY {
  x: number
  y: number
}

/** Tile indices of a window's top-left tile. May lie outside the level; such tiles carry no data. */
export interface WindowOrigin {
  tileX: number
  tileY: number
}

/** South-polar stereographic metres of a location: x towards longitude 90°E, y towards longitude 0°. */
export function polarXY({ lat, lon }: LunarLocation): PolarXY {
  const rho = 2 * MOON_RADIUS_M * Math.tan(((90 + lat) / 2) * RAD)
  return { x: rho * Math.sin(lon * RAD), y: rho * Math.cos(lon * RAD) }
}

/**
 * The window to show for a focus point: centred on the tile corner nearest to it. While the focus
 * stays at least one tile away from the edge of `current`, `current` is kept, so small camera
 * movements around a tile corner do not reload the window.
 */
export function windowOrigin(
  level: TileLevel,
  focus: PolarXY,
  current?: WindowOrigin,
): WindowOrigin {
  const tileX = (level.center_px + focus.x / level.pixel_size_m) / level.tile_px
  const tileY = (level.center_px - focus.y / level.pixel_size_m) / level.tile_px
  if (current) {
    const inside = (tile: number, origin: number) =>
      tile - origin >= 1 && tile - origin <= WINDOW_TILES - 1
    if (inside(tileX, current.tileX) && inside(tileY, current.tileY))
      return current
  }
  return {
    tileX: Math.round(tileX) - WINDOW_TILES / 2,
    tileY: Math.round(tileY) - WINDOW_TILES / 2,
  }
}

export interface WindowTile {
  /** Tile indices within the level. */
  x: number
  y: number
  /** Position within the window, in tiles. */
  slotX: number
  slotY: number
}

/** The window's tiles that exist in the level, row by row. */
export function tilesOfWindow(
  level: TileLevel,
  origin: WindowOrigin,
): WindowTile[] {
  const tiles: WindowTile[] = []
  for (let slotY = 0; slotY < WINDOW_TILES; slotY++)
    for (let slotX = 0; slotX < WINDOW_TILES; slotX++) {
      const x = origin.tileX + slotX
      const y = origin.tileY + slotY
      const inLevel =
        x >= 0 && y >= 0 && x < level.tiles_per_side && y < level.tiles_per_side
      const exists =
        level.tile_ranges?.some(
          ([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
        ) ?? true
      if (inLevel && exists) tiles.push({ x, y, slotX, slotY })
    }
  return tiles
}

/**
 * Assembles tiles into the window image (first row first). Slots without a tile stay all-zero
 * bytes, the tiles' own code for "no data", so the shader falls back to a coarser level there.
 */
export function composeWindow(
  level: TileLevel,
  tiles: readonly { slotX: number; slotY: number; image: RgbaImage }[],
): RgbaImage {
  const tilePx = level.tile_px
  const size = WINDOW_TILES * tilePx
  const data = new Uint8Array(size * size * 4)
  for (const { slotX, slotY, image } of tiles) {
    if (
      image.width !== tilePx ||
      image.height !== tilePx ||
      image.data.length !== tilePx * tilePx * 4
    )
      throw new Error('normal tile size does not match its level')
    for (let row = 0; row < tilePx; row++)
      data.set(
        image.data.subarray(row * tilePx * 4, (row + 1) * tilePx * 4),
        ((slotY * tilePx + row) * size + slotX * tilePx) * 4,
      )
  }
  return { width: size, height: size, data }
}

export interface LoadedWindow {
  level: TileLevel
  origin: WindowOrigin
  image: RgbaImage
}

export interface NormalWindows {
  /**
   * Call with the point the camera looks at. Loads the windows that should change and hands each to
   * `onWindow` once all of its tiles have arrived; until then the previous window stays in use.
   */
  update(focus: PolarXY): void
}

/** Keeps one window per fine level centred on the focus. `levels[i]` is reported as slot `i`. */
export function createNormalWindows(options: {
  levels: readonly TileLevel[]
  baseUrl: string
  signal: AbortSignal
  onWindow: (slot: number, window: LoadedWindow) => void
}): NormalWindows {
  const { levels, baseUrl, signal, onWindow } = options
  const cache = new Map<string, Promise<RgbaImage>>()
  // What each slot shows or is loading; a failed load stays here until the focus asks for another
  // window, so a missing tile is not requested again on every frame.
  const wanted: (WindowOrigin | undefined)[] = levels.map(() => undefined)

  const tile = (level: TileLevel, x: number, y: number) => {
    const key = `${level.z}/${x}/${y}`
    let image = cache.get(key)
    if (image) cache.delete(key)
    else {
      image = fetchTile('normal', { z: level.z, x, y }, baseUrl, signal)
      image.catch(() => cache.delete(key))
    }
    cache.set(key, image) // most recently used last
    for (const oldest of cache.keys()) {
      if (cache.size <= CACHED_TILES) break
      cache.delete(oldest)
    }
    return image
  }

  return {
    update(focus) {
      levels.forEach((level, slot) => {
        const origin = windowOrigin(level, focus, wanted[slot])
        if (origin === wanted[slot]) return
        wanted[slot] = origin
        const tiles = tilesOfWindow(level, origin)
        // Away from the level's tiles (outside the polar cap, or outside a sparse level's regions)
        // there is nothing to load; the previous window stays where it was.
        if (tiles.length === 0) return
        Promise.all(
          tiles.map(async ({ x, y, slotX, slotY }) => ({
            slotX,
            slotY,
            image: await tile(level, x, y),
          })),
        )
          .then((loaded) => {
            if (signal.aborted || wanted[slot] !== origin) return
            onWindow(slot, {
              level,
              origin,
              image: composeWindow(level, loaded),
            })
          })
          // The coarser level underneath keeps showing; nothing else depends on this window.
          .catch(() => undefined)
      })
    },
  }
}
