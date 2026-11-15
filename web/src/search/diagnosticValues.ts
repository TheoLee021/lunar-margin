import type { SiteAssessment } from '../api/analysis'

type Diagnostics = Pick<
  SiteAssessment,
  'terrain_clearance' | 'solar_continuity'
>

function clearanceText(value: number | null | undefined): string {
  if (value === undefined) return '미제공'
  if (value === null) return '가시 구간 없음'
  if (value > 0 && value < 0.001) return '<0.001°'
  return `${value.toFixed(3)}°`
}

function sunlightText(hours: number | undefined): string {
  if (hours === undefined) return '미제공'
  const seconds = Math.round(hours * 3600)
  if (seconds === 0) return hours > 0 ? '<1초' : '0분'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h ? `${h}시간` : '', m ? `${m}분` : '', s ? `${s}초` : '']
    .filter(Boolean)
    .join(' ')
}

/** Keep angular terrain clearance and saved RF power margin in distinct units. */
export function diagnosticValues(
  data: Diagnostics,
  rfMargin: number | null | undefined,
) {
  return {
    sunClearance: clearanceText(data.terrain_clearance?.sun_visible_p10_deg),
    earthClearance: clearanceText(
      data.terrain_clearance?.earth_visible_p10_deg,
    ),
    longestSunlight: sunlightText(
      data.solar_continuity?.longest_sun_visible_hours,
    ),
    transitions:
      data.solar_continuity == null
        ? '미제공'
        : `${data.solar_continuity.visibility_transitions}회`,
    rfMargin: rfMargin == null ? '미계산' : `${rfMargin.toFixed(2)} dB`,
  }
}
