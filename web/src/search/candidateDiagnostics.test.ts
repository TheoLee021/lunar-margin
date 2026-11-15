import { expect, it } from 'vitest'
import { diagnosticValues } from './diagnosticValues'

it('formats geometry in degrees, RF in dB, and a partial sunlight interval as minutes', () => {
  expect(
    diagnosticValues(
      {
        terrain_clearance: {
          sun_visible_p10_deg: 0.0001,
          earth_visible_p10_deg: 1.1,
        },
        solar_continuity: {
          longest_sun_visible_hours: 1 / 6,
          visibility_transitions: 0,
        },
      },
      15.688618,
    ),
  ).toEqual({
    sunClearance: '<0.001°',
    earthClearance: '1.100°',
    longestSunlight: '10분',
    transitions: '0회',
    rfMargin: '15.69 dB',
  })
})

it('distinguishes no visible samples from unavailable diagnostics and keeps true zeroes', () => {
  expect(
    diagnosticValues(
      {
        terrain_clearance: {
          sun_visible_p10_deg: null,
          earth_visible_p10_deg: null,
        },
        solar_continuity: {
          longest_sun_visible_hours: 0,
          visibility_transitions: 0,
        },
      },
      0,
    ),
  ).toEqual({
    sunClearance: '가시 구간 없음',
    earthClearance: '가시 구간 없음',
    longestSunlight: '0분',
    transitions: '0회',
    rfMargin: '0.00 dB',
  })
  expect(diagnosticValues({}, undefined)).toEqual({
    sunClearance: '미제공',
    earthClearance: '미제공',
    longestSunlight: '미제공',
    transitions: '미제공',
    rfMargin: '미계산',
  })
})
