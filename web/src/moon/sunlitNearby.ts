// How much of the ground around each place is sunlit, from a sunlight map. The light that reaches
// shadowed ground is sunlight scattered off sunlit terrain, so the viewer's fill light follows this
// (scene.ts, FILL_REACH_SHARE). Computed once per map, on a grid of coarse cells, so that the shader
// reads it with a single lookup. No Cesium here.
import type { SunlightMap } from './sunlightMap'

export interface SunlitNearby {
  width: number
  height: number
  /** Map pixels along one side of a cell; the last cells hold what is left of the map. */
  cellPx: number
  /** One byte per cell, first row first: 0 = no sunlit ground around, 255 = all of it sunlit. */
  data: Uint8Array
}

// On the wide sunlight map (640 m pixels) a cell is about 5 km, and the windows around a cell are
// 1, 3, 7 and 15 cells across: about 5, 15, 36 and 77 km. The small windows hold the value up at
// the foot of sunlit slopes, the large ones let it fade out over tens of kilometres.
const CELL_PX = 8
const REACH_CELLS: readonly number[] = [0, 1, 3, 7]

/**
 * The sunlit share of the ground around each cell of `cellPx` map pixels: the mean, over square
 * windows reaching `reachCells` cells to each side of the cell, of the share of each window that is
 * sunlit. A window counts only the part of it that lies on the map.
 */
export function sunlitNearby(
  map: SunlightMap,
  {
    cellPx = CELL_PX,
    reachCells = REACH_CELLS,
  }: { cellPx?: number; reachCells?: readonly number[] } = {},
): SunlitNearby {
  const width = Math.ceil(map.width / cellPx)
  const height = Math.ceil(map.height / cellPx)
  // Summed-area tables of the sunlit amount and of the area, with a leading row and column of zeros:
  // the sum over cells [x0, x1) x [y0, y1) is then four lookups.
  const stride = width + 1
  const sunlit = new Float64Array(stride * (height + 1))
  const area = new Float64Array(stride * (height + 1))
  for (let y = 0; y < map.height; y++) {
    const row = (Math.floor(y / cellPx) + 1) * stride + 1
    for (let x = 0; x < map.width; x++) {
      const cell = row + Math.floor(x / cellPx)
      sunlit[cell]! += map.data[y * map.width + x]!
      area[cell]! += 255
    }
  }
  for (const table of [sunlit, area])
    for (let y = 1; y <= height; y++)
      for (let x = 1; x <= width; x++) {
        const i = y * stride + x
        table[i]! += table[i - 1]! + table[i - stride]! - table[i - stride - 1]!
      }
  const within = (
    table: Float64Array,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) =>
    table[y1 * stride + x1]! -
    table[y0 * stride + x1]! -
    table[y1 * stride + x0]! +
    table[y0 * stride + x0]!

  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let share = 0
      for (const reach of reachCells) {
        const x0 = Math.max(0, x - reach)
        const y0 = Math.max(0, y - reach)
        const x1 = Math.min(width, x + reach + 1)
        const y1 = Math.min(height, y + reach + 1)
        share += within(sunlit, x0, y0, x1, y1) / within(area, x0, y0, x1, y1)
      }
      data[y * width + x] = Math.round((255 * share) / reachCells.length)
    }
  return { width, height, cellPx, data }
}
