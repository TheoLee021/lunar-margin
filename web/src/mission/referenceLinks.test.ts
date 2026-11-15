import { describe, expect, it } from 'vitest'
import { horizonsReferenceUrl, siteCoordinates } from './referenceLinks'

describe('JPL Horizons reference links', () => {
  const site = { latitude: -89.7, longitude: 222.4, landing: '2027-01-10' }

  it('builds a lunar-surface Sun ephemeris', () => {
    const url = new URL(horizonsReferenceUrl(site, 'sun'))
    expect(url.origin).toBe('https://ssd.jpl.nasa.gov')
    expect(url.pathname).toBe('/api/horizons.api')
    expect(url.searchParams.get('CENTER')).toBe("'coord@301'")
    expect(url.searchParams.get('COMMAND')).toBe("'10'")
    expect(url.searchParams.get('SITE_COORD')).toBe(
      "'222.400000,-89.700000,0'",
    )
    expect(url.searchParams.get('STOP_TIME')).toBe("'2027-01-11'")
    expect(url.searchParams.get('QUANTITIES')).toBe("'4'")
  })

  it('builds an Earth reference link and normalizes western longitude', () => {
    const url = new URL(
      horizonsReferenceUrl({ ...site, longitude: -137.6 }, 'earth'),
    )
    expect(url.searchParams.get('COMMAND')).toBe("'399'")
    expect(url.searchParams.get('SITE_COORD')).toBe(
      "'222.400000,-89.700000,0'",
    )
    expect(url.searchParams.get('START_TIME')).toBe("'2027-01-10'")
  })

  it('rolls the calendar over at month and year boundaries', () => {
    const url = new URL(
      horizonsReferenceUrl({ ...site, landing: '2027-12-31' }, 'sun'),
    )
    expect(url.searchParams.get('STOP_TIME')).toBe("'2028-01-01'")
  })

  it('rejects invalid dates and site coordinates', () => {
    expect(() =>
      horizonsReferenceUrl({ ...site, landing: '2027-02-30' }, 'sun'),
    ).toThrow('Invalid landing date')
    expect(() =>
      horizonsReferenceUrl({ ...site, latitude: -91 }, 'sun'),
    ).toThrow('Invalid lunar site')
  })

  it('prints normalized lunar coordinates for reference', () => {
    expect(siteCoordinates({ latitude: -89.7, longitude: -137.6 })).toBe(
      'Latitude: -89.70000°, Longitude: 222.40000° E',
    )
  })
})
