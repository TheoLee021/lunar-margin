interface PriceExclusion {
  excluded_reason: string | null
  aim_slope_deg: number | null
  landable_fraction: number | null
}

/** Human-readable reasons remain visible without hovering over a price cell. */
export function priceExclusionText(cell: PriceExclusion): string {
  if (cell.excluded_reason === 'aim_point_slope_above_10_deg') {
    const slope = cell.aim_slope_deg
    return slope === null
      ? '중심 경사가 기존 가격 한도 10° 초과'
      : `중심 경사 ${slope.toFixed(2)}° > 기존 가격 한도 10°`
  }
  if (cell.excluded_reason === 'landable_fraction_below_0.05') {
    return cell.landable_fraction === null
      ? '저경사 면적 비율이 기존 가격 한도 5% 미만'
      : `저경사 면적 비율 ${(cell.landable_fraction * 100).toFixed(1)}% < 기존 가격 한도 5%`
  }
  return '가격 모델의 지형 조건 미충족'
}
