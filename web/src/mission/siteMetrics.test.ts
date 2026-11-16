import { describe, expect, it } from 'vitest'
import type { Candidate, SearchConfig } from '../api/candidates'
import { siteMetrics } from './siteMetrics'

type Site = Parameters<typeof siteMetrics>[0]

const TERRAIN: NonNullable<Candidate['terrain']> = {
  slope_p95_deg: 8,
  roughness_p95_m: 1.5,
  coverage_fraction: 1,
  assessment_radius_m: 250,
  slope_baseline_m: 160,
  roughness_window_m: 400,
  dem_pixel_m: 80,
  landing_safety_status: 'UNVERIFIED',
}

const RF_METRICS: NonNullable<Candidate['rf']> = {
  fraction: 0.8,
  longest_blackout_hours: 5,
  min_link_margin_db: 4,
  required_ebn0_db: 1,
  rx_required_dbw: -150,
  evaluation_hours: 336,
  available_hours: 268.8,
}

const RF_SCENARIO = {} as NonNullable<SearchConfig['rf']>

function site(overrides: Partial<Site> = {}): Site {
  return {
    sun: {
      fraction: 0.6,
      longest_dark_hours: 20,
      windows_per_24h: 1,
      mean_elevation_deg: 1.2,
    },
    earth: {
      fraction: 0.75,
      longest_blackout_hours: 4,
      windows_per_24h: 0.5,
      mean_elevation_deg: 4,
    },
    terrain: TERRAIN,
    rf: null,
    ...overrides,
  }
}

const shown = (metrics: ReturnType<typeof siteMetrics>) =>
  metrics.map((metric) => [metric.label, metric.value, metric.unit])

describe('siteMetrics', () => {
  it('저장된 후보 지표 여섯 개를 패널에 보이는 순서로 낸다', () => {
    expect(shown(siteMetrics(site(), { rf: null }))).toEqual([
      ['Sunlight', 60, '%'],
      ['Communication', 75, '%'],
      ['Longest darkness', 20, 'h'],
      ['Longest comm outage', 4, 'h'],
      ['Local slope', 8, '°'],
      ['Local roughness', 1.5, 'm'],
    ])
  })

  it('지구 LOS 탐색은 저장된 RF 값이 있어도 통신을 지구 가시성으로 본다', () => {
    const metrics = siteMetrics(site({ rf: RF_METRICS }), { rf: null })
    expect(metrics.map((metric) => metric.basis)).toEqual([
      undefined,
      'Earth LOS',
      undefined,
      'Earth LOS',
      undefined,
      undefined,
    ])
    expect(metrics[1]?.value).toBe(75)
    expect(metrics[3]?.value).toBe(4)
  })

  it('RF 탐색은 통신을 명목 RF 값으로 본다', () => {
    const metrics = siteMetrics(site({ rf: RF_METRICS }), { rf: RF_SCENARIO })
    expect(metrics[1]).toMatchObject({
      label: 'Communication',
      basis: 'RF',
      value: 80,
    })
    expect(metrics[3]).toMatchObject({
      label: 'Longest comm outage',
      basis: 'RF',
      value: 5,
    })
  })

  it('값이 없는 지표는 0이 아니라 비워 둔다', () => {
    const metrics = siteMetrics(
      site({
        terrain: null,
        sun: { ...site().sun, fraction: null },
        rf: null,
      }),
      { rf: RF_SCENARIO },
    )
    expect(metrics.map((metric) => metric.value)).toEqual([
      null,
      null,
      20,
      null,
      null,
      null,
    ])
  })

  it('거칠기가 없는 예전 탐색 결과도 경사는 보여 준다', () => {
    const metrics = siteMetrics(
      site({ terrain: { ...TERRAIN, roughness_p95_m: undefined } }),
      { rf: null },
    )
    expect(metrics[4]?.value).toBe(8)
    expect(metrics[5]?.value).toBeNull()
  })
})
