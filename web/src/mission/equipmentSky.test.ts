import { describe, expect, it } from 'vitest'
import { skyFromAnalysis } from './equipmentSky'

const response = {
  lat: -89.83,
  lon: -153.7,
  start: '2027-01-10T00:00:00Z',
  end: '2027-01-10T00:30:00Z',
  step_minutes: 30,
  observer_height_m: 2,
  metrics: {
    visible_fraction: 1,
    longest_dark_hours: 0,
    windows_per_24h: 0,
    mean_elevation_deg: 1.2,
  },
  horizon: { azimuth_deg: [0], elevation_deg: [0.5] },
  series: {
    times: ['2027-01-10T00:00:00Z'],
    body_azimuth_deg: [212.4],
    body_elevation_deg: [1.2],
    visible: [true],
  },
  windows: [],
  dark_periods: [],
}

describe('skyFromAnalysis', () => {
  it('reads the horizon height at the azimuth of the body itself', () => {
    const tilted = {
      ...response,
      horizon: { azimuth_deg: [0, 180], elevation_deg: [0, 4] },
    }
    // 212.4 deg sits between the 180 deg sample and the 0 deg one wrapped to 360.
    expect(skyFromAnalysis(tilted).horizonDeg).toBeCloseTo(3.28, 2)
  })

  it('takes the first sample of the series', () => {
    expect(skyFromAnalysis(response)).toEqual({
      azimuthDeg: 212.4,
      elevationDeg: 1.2,
      horizonDeg: 0.5,
      visible: true,
    })
  })

  it('carries a blocked verdict through unchanged', () => {
    const blocked = {
      ...response,
      series: {
        ...response.series,
        body_elevation_deg: [-0.3],
        visible: [false],
      },
    }
    expect(skyFromAnalysis(blocked)).toEqual({
      azimuthDeg: 212.4,
      elevationDeg: -0.3,
      horizonDeg: 0.5,
      visible: false,
    })
  })

  it('rejects an empty series rather than inventing a direction', () => {
    const empty = {
      ...response,
      series: {
        times: [],
        body_azimuth_deg: [],
        body_elevation_deg: [],
        visible: [],
      },
    }
    expect(() => skyFromAnalysis(empty)).toThrow()
  })
})

it('uses the API clearance before rounding the card angles', () => {
  const series = { ...response.series, terrain_clearance_deg: [0.0004] }
  expect(skyFromAnalysis({ ...response, series }).clearanceDeg).toBe(0.0004)
})
