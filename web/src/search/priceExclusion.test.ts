import { expect, it } from 'vitest'
import { priceExclusionText } from './priceExclusion'

it('explains the legacy center slope exclusion with its actual angle', () => {
  expect(
    priceExclusionText({
      excluded_reason: 'aim_point_slope_above_10_deg',
      aim_slope_deg: 10.0693475778,
      landable_fraction: 0.28346,
    }),
  ).toBe('중심 경사 10.07° > 기존 가격 한도 10°')
})

it('shows the actual low-slope area fraction instead of an unexplained exclusion', () => {
  expect(
    priceExclusionText({
      excluded_reason: 'landable_fraction_below_0.05',
      aim_slope_deg: null,
      landable_fraction: 0.025,
    }),
  ).toBe('저경사 면적 비율 2.5% < 기존 가격 한도 5%')
})
