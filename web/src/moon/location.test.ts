import { describe, expect, it } from 'vitest'
import { gridCellCorners, offsetLocation, toLunarLocation } from './location'

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

describe('offsetLocation', () => {
  it('returns the origin for a zero offset', () => {
    expect(offsetLocation({ lat: -89.83, lon: -153.7 }, 0, 0)).toEqual({
      lat: -89.83,
      lon: -153.7,
    })
  })

  it('moves toward the equator for a northward offset', () => {
    // 1 km north on a 1737.4 km sphere is 1000 / 1737400 rad = 0.0329777 deg.
    const moved = offsetLocation({ lat: -89, lon: 40 }, 0, 1000)
    expect(moved.lat).toBeCloseTo(-88.9670223, 5)
    expect(moved.lon).toBeCloseTo(40, 5)
  })

  it('spreads an eastward offset over more longitude the closer it is to the pole', () => {
    const nearPole = offsetLocation({ lat: -89.8, lon: 0 }, 100, 0)
    const farther = offsetLocation({ lat: -85, lon: 0 }, 100, 0)
    expect(nearPole.lon).toBeGreaterThan(farther.lon)
    expect(farther.lon).toBeCloseTo(0.037849, 4)
  })

  it('walks over the pole instead of breaking down at it', () => {
    // 1 km south from 300 m short of the pole comes out the far side, 697 m past it.
    const moved = offsetLocation({ lat: -89.99, lon: 20 }, 0, -1000)
    expect(moved.lat).toBeCloseTo(-89.9770223, 5)
    expect(moved.lon).toBeCloseTo(-160, 4)
  })

  it('keeps the offset distance, so a diagonal is not stretched', () => {
    const origin = { lat: -88.5, lon: 272.9 }
    const moved = offsetLocation(origin, 300, 400)
    expect(distanceM(origin, moved)).toBeCloseTo(500, 3)
  })
})

/** Great-circle distance in metres on the same 1737.4 km sphere, for checking offsets. */
function distanceM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 1_737_400
}
