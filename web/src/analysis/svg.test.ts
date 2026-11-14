import { describe, expect, it } from 'vitest'
import { linePath, scale } from './svg'

describe('linePath', () => {
  it('builds an M/L path with 1-decimal precision', () => {
    expect(
      linePath([
        [0, 0],
        [10.04, 5.06],
      ]),
    ).toBe('M0 0L10 5.1')
  })

  it('returns an empty string for no points', () => {
    expect(linePath([])).toBe('')
  })
})

describe('scale', () => {
  it('maps linearly and supports inverted ranges', () => {
    expect(scale(5, 0, 10, 0, 100)).toBe(50)
    expect(scale(2, 0, 10, 100, 0)).toBe(80)
  })

  it('returns the range midpoint for a degenerate domain', () => {
    expect(scale(3, 3, 3, 0, 10)).toBe(5)
  })
})
