import { describe, expect, it } from 'vitest'
import { horizonsReferenceUrl, siteCoordinates } from './referenceLinks'

const site = { latitude: -89.7, longitude: 222.4, landing: '2027-01-10' }

describe('JPL Horizons links', () => {
  it('sets a lunar observer and Sun target', () => {
    const url = new URL(horizonsReferenceUrl(site, 'sun'))
    expect(url.hostname).toBe('ssd.jpl.nasa.gov')
    expect(url.searchParams.get('CENTER')).toBe("'coord@301'")
    expect(url.searchParams.get('COMMAND')).toBe("'10'")
    expect(url.searchParams.get('STOP_TIME')).toBe("'2027-01-11'")
  })

  it('uses Earth as a separate target', () => {
    const url = new URL(horizonsReferenceUrl(site, 'earth'))
    expect(url.searchParams.get('COMMAND')).toBe("'399'")
  })

  it('normalizes west longitude', () => {
    const result = siteCoordinates({ latitude: -89.7, longitude: -137.6 })
    expect(result).toContain('222.40000° E')
  })

  it('rejects impossible latitude', () => {
    const invalid = { ...site, latitude: -91 }
    expect(() => horizonsReferenceUrl(invalid, 'sun')).toThrow()
  })
})
