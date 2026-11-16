import { expect, it } from 'vitest'
import {
  readRequirements,
  requirementLimits,
  writeRequirements,
  type Requirements,
} from './requirements'

const SOME: Requirements = {
  minSunPercent: 70,
  minCommPercent: null,
  maxDarknessHours: 24,
  maxBlackoutHours: 0,
  maxRoughnessM: 2.5,
}

it('reads back the requirements it wrote to the URL, keeping "no limit" apart from zero', () => {
  const params = new URLSearchParams()
  writeRequirements(params, SOME)

  expect(params.get('min_comm')).toBe('none')
  expect(readRequirements(params)).toEqual(SOME)
})

it.each(['arrival=2027-01-10', 'min_sun=101', 'max_dark='])(
  'has no requirements for a URL with %s',
  (query) => {
    expect(readRequirements(new URLSearchParams(query))).toBeUndefined()
  },
)

it('turns percentages into fractions and leaves unset optional limits out of the request', () => {
  expect(requirementLimits(SOME)).toEqual({
    min_sunlight_fraction: 0.7,
    max_continuous_darkness_hours: 24,
    max_communication_blackout_hours: 0,
    max_terrain_roughness_m: 2.5,
  })
})
