import { expect, it } from 'vitest'
import type { MissionSelection } from '../mission/types'
import {
  applySearch,
  parseSearchForm,
  type SearchFormValues,
} from './searchForm'

const VALUES: SearchFormValues = {
  landing: '2027-03-01',
  duration: '14',
  minSunPercent: '70',
  minCommPercent: '',
  maxDarknessHours: '24',
  maxBlackoutHours: '0',
  maxSlopeDeg: '10',
  maxRoughnessM: '',
}

it('reads the form, with an empty limit meaning no limit rather than zero', () => {
  expect(parseSearchForm(VALUES)).toEqual({
    ok: true,
    search: {
      landing: '2027-03-01',
      duration: 14,
      maxSlope: 10,
      requirements: {
        minSunPercent: 70,
        minCommPercent: null,
        maxDarknessHours: 24,
        maxBlackoutHours: 0,
        maxRoughnessM: null,
      },
    },
  })
})

it.each([
  ['landing', '2027-02-30'],
  ['landing', '2149-12-25'], // the 14-day mission ends outside the ephemeris (2150)
  ['duration', '10'],
  ['minSunPercent', '101'],
  ['maxDarknessHours', '-2'],
  ['maxSlopeDeg', '0'],
] as const)('rejects %s = "%s" on that field', (field, value) => {
  const result = parseSearchForm({ ...VALUES, [field]: value })

  expect(!result.ok && Object.keys(result.errors)).toEqual([field])
})

it('moves the departure with a new landing date and drops the launch and site chosen for the old one', () => {
  const selection: MissionSelection = {
    departure: '2027-01-06',
    landing: '2027-01-10',
    duration: 14,
    launchId: 'spacex-demo',
    siteId: 'site-1',
  }
  const parsed = parseSearchForm(VALUES)
  if (!parsed.ok) throw new Error('expected a valid form')

  expect(applySearch(selection, parsed.search)).toEqual({
    departure: '2027-02-25',
    landing: '2027-03-01',
    duration: 14,
    launchId: null,
    siteId: null,
    maxSlope: 10,
    requirements: parsed.search.requirements,
  })
})
