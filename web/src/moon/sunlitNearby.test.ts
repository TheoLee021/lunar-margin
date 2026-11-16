import { describe, expect, it } from 'vitest'
import { sunlitNearby } from './sunlitNearby'
import type { SunlightMap } from './sunlightMap'

/** A square map from rows of bytes. */
function mapOf(rows: number[][]): SunlightMap {
  return {
    width: rows[0]!.length,
    height: rows.length,
    data: Uint8Array.from(rows.flat()),
  }
}

function uniform(size: number, value: number): SunlightMap {
  return mapOf(
    Array.from({ length: size }, () =>
      Array.from({ length: size }, () => value),
    ),
  )
}

describe('sunlitNearby', () => {
  it('has one value per cell of the map, none where all is shadow and the most where all is sunlit', () => {
    const dark = sunlitNearby(uniform(8, 0), { cellPx: 2 })
    const lit = sunlitNearby(uniform(8, 255), { cellPx: 2 })

    expect([dark.width, dark.height]).toEqual([4, 4])
    expect(Array.from(dark.data)).toEqual(Array(16).fill(0))
    expect(Array.from(lit.data)).toEqual(Array(16).fill(255))
  })

  it('averages the sunlit share over windows around each cell, so it falls off away from sunlit ground', () => {
    // 5 x 5 cells of 2 px, only the middle cell sunlit.
    const rows = Array.from({ length: 10 }, (_, y) =>
      Array.from({ length: 10 }, (_, x) =>
        y >= 4 && y < 6 && x >= 4 && x < 6 ? 255 : 0,
      ),
    )

    const nearby = sunlitNearby(mapOf(rows), { cellPx: 2, reachCells: [0, 1] })

    // The cell itself: all of its own cell and 1 of the 9 cells around it, (1 + 1/9) / 2 of 255.
    // Its neighbours: none of their own cell and 1 of 9, (0 + 1/9) / 2 of 255. Further out: nothing.
    expect(Array.from(nearby.data)).toEqual(
      [
        [0, 0, 0, 0, 0],
        [0, 14, 14, 14, 0],
        [0, 14, 142, 14, 0],
        [0, 14, 14, 14, 0],
        [0, 0, 0, 0, 0],
      ].flat(),
    )
  })

  it('counts only the part of a window that lies on the map, so the edge of the map is no darker', () => {
    // 4 x 4 cells of 2 px, only the corner cell sunlit, windows of 3 x 3 cells.
    const rows = Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 8 }, (_, x) => (y < 2 && x < 2 ? 255 : 0)),
    )

    const corner = sunlitNearby(mapOf(rows), { cellPx: 2, reachCells: [1] })

    // At the corner 2 x 2 cells of the window are on the map: 1 of 4, not 1 of 9.
    expect(corner.data[0]).toBe(64)
    // One cell in from the corner the whole window is on the map: 1 of 9.
    expect(corner.data[1 * 4 + 1]).toBe(28)
    expect(corner.data[2 * 4 + 2]).toBe(0)

    // A map that does not divide into whole cells: the last cells hold what is left of it.
    const odd = sunlitNearby(uniform(5, 255), { cellPx: 2 })
    expect([odd.width, odd.height]).toEqual([3, 3])
    expect(Array.from(odd.data)).toEqual(Array(9).fill(255))
  })

  it('takes partly sunlit pixels by their share', () => {
    const half = sunlitNearby(uniform(8, 128), { cellPx: 2 })

    expect(Array.from(half.data)).toEqual(Array(16).fill(128))
  })
})
