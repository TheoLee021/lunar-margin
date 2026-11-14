import { describe, expect, it } from 'vitest'
import { parseSunDirection } from './sun'

describe('parseSunDirection', () => {
  it('returns the direction as a unit vector', () => {
    expect(parseSunDirection([0, 3, 4])).toEqual([0, 0.6, 0.8])
  })

  it.each([
    ['a zero vector', [0, 0, 0]],
    ['a NaN component', [1, Number.NaN, 0]],
    ['an infinite component', [Number.POSITIVE_INFINITY, 0, 0]],
    ['two components', [1, 0]],
    ['a non-array', { x: 1, y: 0, z: 0 }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseSunDirection(input)).toThrow()
  })
})
