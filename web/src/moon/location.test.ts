import { describe, expect, it } from 'vitest'
import { gridCellCorners, toLunarLocation } from './location'

describe('toLunarLocation', () => {
  it('converts a cartographic position in radians to degrees', () => {
    // Shackleton crater centre, 89.67°S 129.78°E
    const location = toLunarLocation({
      latitude: -1.5650367,
      longitude: 2.2650883,
    })
    expect(location.lat).toBeCloseTo(-89.67, 3)
    expect(location.lon).toBeCloseTo(129.78, 3)
  })

  it('wraps longitudes past the antimeridian into -180..180', () => {
    expect(
      toLunarLocation({ latitude: 0, longitude: 3.3161256 }).lon,
    ).toBeCloseTo(-170, 5)
    expect(
      toLunarLocation({ latitude: 0, longitude: -3.3161256 }).lon,
    ).toBeCloseTo(170, 5)
  })
})

// Reference corners from the candidate engine's south-polar projection, in metres.
describe('gridCellCorners', () => {
  it('places a real 500m grid boundary around the saved projected sample', () => {
    const corners = gridCellCorners({ x_m: 32500, y_m: -21000, spacing_m: 500 })
    const expected = [
      [-88.72639498917154, 123.38147564720538],
      [-88.71259605371309, 122.97772331381645],
      [-88.72149525728216, 122.35784767211015],
      [-88.7353913261792, 122.75766880112553],
    ]
    expect(corners).toHaveLength(4)
    corners.forEach((point, i) => {
      expect(point.lat).toBeCloseTo(expected[i]![0]!, 9)
      expect(point.lon).toBeCloseTo(expected[i]![1]!, 9)
    })
  })
  it('keeps pole-crossing cells finite and rejects invalid grid sizes', () => {
    const corners = gridCellCorners({ x_m: 0, y_m: 0, spacing_m: 500 })
    expect(corners.map((point) => point.lon)).toEqual([-135, 135, 45, -45])
    expect(corners.every((point) => Number.isFinite(point.lat))).toBe(true)
    expect(() => gridCellCorners({ x_m: 0, y_m: 0, spacing_m: 0 })).toThrow()
    expect(() =>
      gridCellCorners({ x_m: Number.NaN, y_m: 0, spacing_m: 500 }),
    ).toThrow()
  })
})
