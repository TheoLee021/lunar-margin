import { describe, expect, it } from 'vitest'
import { assetCardText } from './assetCard'

const clear = { azimuthDeg: 212.4, elevationDeg: 4.01, horizonDeg: 1.47 }
const blocked = {
  azimuthDeg: 212.4,
  elevationDeg: 0.4,
  horizonDeg: 1.5,
  visible: false,
}

describe('assetCardText', () => {
  it('leads with the name and says how much room the sight has', () => {
    expect(
      assetCardText({
        label: 'Trencher',
        observerHeightM: 2,
        earth: { ...clear, visible: true },
      }).split('\n'),
    ).toEqual([
      'Trencher',
      'Earth visible · margin 2.54°',
      '  elevation 4.01° / horizon 1.47°',
      'Observer height 2 m',
    ])
  })

  it('says how far short a blocked sight falls', () => {
    const lines = assetCardText({
      label: 'Seismometer A',
      observerHeightM: 0.4,
      earth: blocked,
    }).split('\n')
    expect(lines[1]).toBe('Earth blocked · short by 1.10°')
    expect(lines[3]).toBe('Observer height 0.4 m')
  })

  it('does not invent numbers before the place has been measured', () => {
    const lines = assetCardText({
      label: 'Radiator',
      observerHeightM: 0.5,
      earth: null,
    }).split('\n')
    expect(lines).toEqual([
      'Radiator',
      'Earth visibility pending',
      'Observer height 0.5 m',
    ])
    expect(lines.join('\n')).not.toContain('°')
  })

  it('shows the Sun next to the Earth when it was measured', () => {
    const lines = assetCardText({
      label: 'Solar array',
      observerHeightM: 10,
      earth: { ...clear, visible: true },
      sun: {
        azimuthDeg: 95,
        elevationDeg: 0.6,
        horizonDeg: 1.4,
        visible: false,
      },
    }).split('\n')
    expect(lines[3]).toBe('Sun blocked · short by 0.80°')
    expect(lines).toHaveLength(6)
  })

  it('leaves the Sun out entirely when it was not asked for', () => {
    expect(
      assetCardText({
        label: 'Seismometer A',
        observerHeightM: 0.4,
        earth: { ...clear, visible: true },
      }),
    ).not.toContain('Sun')
  })

  it('writes a whole number of metres without a decimal point', () => {
    expect(
      assetCardText({
        label: 'Solar array',
        observerHeightM: 10,
        earth: null,
      }),
    ).toContain('Observer height 10 m')
  })
})

it('distinguishes a failed measurement and a small positive clearance', () => {
  const card = assetCardText({
    label: 'Antenna',
    observerHeightM: 2,
    measured: true,
    earth: { ...clear, visible: true, clearanceDeg: 0.0004 },
    sun: null,
  })
  expect(card).toContain('Earth visible · margin <0.01°')
  expect(card).toContain('Sun visibility failed')
})
