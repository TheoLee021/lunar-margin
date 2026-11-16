import { describe, expect, it } from 'vitest'
import type { Candidate, SearchConfig } from '../api/candidates'
import {
  formatAmount,
  limitAlerts,
  requirementMargins,
} from './requirementMargins'

type Site = Parameters<typeof requirementMargins>[0]
type Config = Parameters<typeof requirementMargins>[1]

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

const RF_SCENARIO: NonNullable<SearchConfig['rf']> = {
  frequency_hz: 23_170_000_000,
  tx_power_w: 1,
  tx_gain_dbi: 33.2,
  rx_gain_dbi: 71.1,
  tx_system_loss_db: 1,
  tx_pointing_loss_db: 0.3,
  rx_pointing_loss_db: 0,
  rx_waveguide_loss_db: 0,
  system_noise_temp_k: 512,
  information_rate_bps: 230_000,
  implementation_loss_db: 3,
  target_margin_db: 3,
  required_esn0_db: -2.35,
  eta_tot: 0.490243,
}

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

function config(
  thresholds: Partial<Config['thresholds']> = {},
  rf: Config['rf'] = null,
): Config {
  return {
    rf,
    thresholds: {
      min_sun_fraction: null,
      max_sun_dark_hours: null,
      min_earth_fraction: null,
      max_earth_blackout_hours: null,
      ...thresholds,
    },
  }
}

const row = (rows: ReturnType<typeof requirementMargins>, key: string) =>
  rows.find((entry) => entry.key === key)

describe('requirementMargins', () => {
  it('상한 조건은 한도에서 값을 뺀 만큼이 여유다', () => {
    const rows = requirementMargins(site(), config({ max_sun_dark_hours: 24 }))
    expect(rows).toEqual([
      {
        key: 'sun-dark',
        label: 'Longest darkness',
        bound: 'max',
        unit: 'h',
        value: 20,
        limit: 24,
        margin: 4,
      },
    ])
  })

  it('한도를 넘은 값은 여유가 음수다', () => {
    const rows = requirementMargins(
      site({ sun: { ...site().sun, longest_dark_hours: 30 } }),
      config({ max_sun_dark_hours: 24 }),
    )
    expect(row(rows, 'sun-dark')?.margin).toBe(-6)
  })

  it('값이 한도와 같으면 여유는 0이다', () => {
    const rows = requirementMargins(
      site(),
      config({ max_sun_dark_hours: 20, min_earth_fraction: 0.75 }),
    )
    expect(row(rows, 'sun-dark')?.margin).toBe(0)
    expect(row(rows, 'communication-fraction')?.margin).toBe(0)
  })

  it('하한 조건은 값에서 한도를 뺀 만큼이 여유고, 비율은 퍼센트로 센다', () => {
    const rows = requirementMargins(site(), config({ min_sun_fraction: 0.5 }))
    const sun = row(rows, 'sun-fraction')
    expect(sun).toMatchObject({ bound: 'min', unit: '%', label: 'Sunlight' })
    expect(sun?.value).toBeCloseTo(60)
    expect(sun?.limit).toBeCloseTo(50)
    expect(sun?.margin).toBeCloseTo(10)

    const short = requirementMargins(site(), config({ min_sun_fraction: 0.7 }))
    expect(row(short, 'sun-fraction')?.margin).toBeCloseTo(-10)
  })

  it('한도가 없는 조건은 행을 만들지 않는다', () => {
    expect(requirementMargins(site(), config())).toEqual([])
    const rows = requirementMargins(
      site(),
      config({ max_terrain_slope_degrees: 10 }),
    )
    expect(rows.map((entry) => entry.key)).toEqual(['slope'])
    expect(rows[0]).toMatchObject({ unit: '°', value: 8, limit: 10, margin: 2 })
  })

  it('값이 없으면 행은 남기되 여유를 비워 둔다', () => {
    const rows = requirementMargins(
      site({
        terrain: null,
        sun: { ...site().sun, longest_dark_hours: null },
      }),
      config({
        max_sun_dark_hours: 24,
        max_terrain_slope_degrees: 10,
        max_terrain_roughness_m: 2,
      }),
    )
    expect(rows.map((entry) => [entry.key, entry.value, entry.margin])).toEqual(
      [
        ['sun-dark', null, null],
        ['slope', null, null],
        ['roughness', null, null],
      ],
    )
  })

  it('지구 LOS 탐색은 통신 조건을 지구 가시성으로 본다', () => {
    const rows = requirementMargins(
      site({ rf: RF_METRICS }),
      config({
        max_earth_blackout_hours: 6,
        max_rf_blackout_hours: 6,
        min_rf_fraction: 0.5,
      }),
    )
    expect(rows).toEqual([
      {
        key: 'communication-blackout',
        label: 'Longest Earth blackout',
        bound: 'max',
        unit: 'h',
        value: 4,
        limit: 6,
        margin: 2,
      },
    ])
  })

  it('RF 탐색은 통신 조건을 명목 RF 값으로 본다', () => {
    const rows = requirementMargins(
      site({ rf: RF_METRICS }),
      config(
        {
          min_earth_fraction: 0.7,
          max_earth_blackout_hours: 6,
          min_rf_fraction: 0.5,
          max_rf_blackout_hours: 6,
        },
        RF_SCENARIO,
      ),
    )
    expect(rows.map((entry) => entry.label)).toEqual([
      'RF availability',
      'Longest RF outage',
    ])
    expect(row(rows, 'communication-fraction')?.margin).toBeCloseTo(30)
    expect(row(rows, 'communication-blackout')).toMatchObject({
      value: 5,
      limit: 6,
      margin: 1,
    })
  })

  it('RF 탐색인데 RF 값이 없으면 지구 값으로 대신하지 않는다', () => {
    const rows = requirementMargins(
      site({ rf: null }),
      config({ max_rf_blackout_hours: 6 }, RF_SCENARIO),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      label: 'Longest RF outage',
      value: null,
      margin: null,
    })
  })
})

describe('formatAmount', () => {
  it('단위마다 정해진 자릿수와 표기로 쓴다', () => {
    expect(formatAmount(60, '%')).toBe('60.0%')
    expect(formatAmount(20, 'h')).toBe('20.0 h')
    expect(formatAmount(8, '°')).toBe('8.0°')
    expect(formatAmount(1.5, 'm')).toBe('1.50 m')
  })
})

describe('limitAlerts', () => {
  it('한도 안쪽이거나 값이 없는 조건은 알리지 않는다', () => {
    const rows = requirementMargins(
      site({ terrain: null }),
      config({
        max_sun_dark_hours: 20,
        min_sun_fraction: 0.5,
        max_terrain_slope_degrees: 10,
      }),
    )
    expect(limitAlerts(rows)).toEqual([])
  })

  it('상한을 넘은 조건은 값과 한도, 넘은 양을 말한다', () => {
    const rows = requirementMargins(
      site({ sun: { ...site().sun, longest_dark_hours: 30 } }),
      config({ max_sun_dark_hours: 24 }),
    )
    expect(limitAlerts(rows)).toEqual([
      'Longest darkness 30.0 h · limit ≤ 24.0 h · over by 6.0 h',
    ])
  })

  it('하한에 못 미친 비율은 모자란 양을 퍼센트포인트로 말한다', () => {
    const rows = requirementMargins(
      site(),
      config({ min_sun_fraction: 0.7, max_terrain_slope_degrees: 5 }),
    )
    expect(limitAlerts(rows)).toEqual([
      'Sunlight 60.0% · limit ≥ 70.0% · short by 10.0 pp',
      'Local slope P95 8.0° · limit ≤ 5.0° · over by 3.0°',
    ])
  })
})
