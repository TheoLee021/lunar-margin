import { describe, expect, it } from 'vitest'
import { parseSunDirection, sunDirectionFromLocal } from './sun'

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

describe('sunDirectionFromLocal', () => {
  const close = (actual: readonly number[], expected: readonly number[]) =>
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 9))

  it('points up, north and east at the equator and prime meridian', () => {
    close(sunDirectionFromLocal({ lat: 0, lon: 0 }, 0, 90), [1, 0, 0])
    close(sunDirectionFromLocal({ lat: 0, lon: 0 }, 0, 0), [0, 0, 1])
    close(sunDirectionFromLocal({ lat: 0, lon: 0 }, 90, 0), [0, 1, 0])
  })

  it('treats north as away from the south pole, matching the engine azimuth 0°', () => {
    // 남위 89°, 경도 0°: 북쪽(위도가 커지는, 남극에서 멀어지는 방향)은 거의 +X, 동쪽은 +Y
    const north = sunDirectionFromLocal({ lat: -89, lon: 0 }, 0, 0)
    const east = sunDirectionFromLocal({ lat: -89, lon: 0 }, 90, 0)
    close(north, [
      Math.sin((89 * Math.PI) / 180),
      0,
      Math.cos((89 * Math.PI) / 180),
    ])
    close(east, [0, 1, 0])
  })

  it('raises the vector by the elevation angle', () => {
    // 경도 90°, 적도: 위 = +Y, 서쪽(방위각 270°) = +X
    const v = sunDirectionFromLocal({ lat: 0, lon: 90 }, 270, 30)
    close(v, [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0])
  })
})
