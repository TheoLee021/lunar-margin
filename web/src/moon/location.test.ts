import { describe, expect, it } from 'vitest'
import { toLunarLocation } from './location'

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
