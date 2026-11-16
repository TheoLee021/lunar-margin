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
        label: '트렌처',
        observerHeightM: 2,
        earth: { ...clear, visible: true },
      }).split('\n'),
    ).toEqual([
      '트렌처',
      '지구 보임 · 여유 2.54°',
      '  고도 4.01° / 지평선 1.47°',
      '관측 높이 2 m',
    ])
  })

  it('says how far short a blocked sight falls', () => {
    const lines = assetCardText({
      label: '지진계 A',
      observerHeightM: 0.4,
      earth: blocked,
    }).split('\n')
    expect(lines[1]).toBe('지구 차폐 · 1.10° 모자람')
    expect(lines[3]).toBe('관측 높이 0.4 m')
  })

  it('does not invent numbers before the place has been measured', () => {
    const lines = assetCardText({
      label: '방열판',
      observerHeightM: 0.5,
      earth: null,
    }).split('\n')
    expect(lines).toEqual(['방열판', '지구 가시성 계산 전', '관측 높이 0.5 m'])
    expect(lines.join('\n')).not.toContain('°')
  })

  it('shows the Sun next to the Earth when it was measured', () => {
    const lines = assetCardText({
      label: '태양광 어레이',
      observerHeightM: 10,
      earth: { ...clear, visible: true },
      sun: {
        azimuthDeg: 95,
        elevationDeg: 0.6,
        horizonDeg: 1.4,
        visible: false,
      },
    }).split('\n')
    expect(lines[3]).toBe('태양 차폐 · 0.80° 모자람')
    expect(lines).toHaveLength(6)
  })

  it('leaves the Sun out entirely when it was not asked for', () => {
    expect(
      assetCardText({
        label: '지진계 A',
        observerHeightM: 0.4,
        earth: { ...clear, visible: true },
      }),
    ).not.toContain('태양')
  })

  it('writes a whole number of metres without a decimal point', () => {
    expect(
      assetCardText({
        label: '태양광 어레이',
        observerHeightM: 10,
        earth: null,
      }),
    ).toContain('관측 높이 10 m')
  })
})

it('distinguishes a failed measurement and a small positive clearance', () => {
  const card = assetCardText({
    label: '안테나',
    observerHeightM: 2,
    measured: true,
    earth: { ...clear, visible: true, clearanceDeg: 0.0004 },
    sun: null,
  })
  expect(card).toContain('지구 보임 · 여유 <0.01°')
  expect(card).toContain('태양 가시성 계산 실패')
})
