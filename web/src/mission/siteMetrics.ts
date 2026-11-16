import type { Candidate, SearchConfig } from '../api/candidates'
import type { RequirementMargin } from './requirementMargins'

/** 선택한 후보 패널에 카드로 보이는 저장된 지표 하나. */
export interface SiteMetric {
  key: 'sun' | 'communication' | 'dark' | 'blackout' | 'slope' | 'roughness'
  label: string
  /** 통신 지표가 무엇을 기준으로 한 값인지. 통신이 아닌 지표에는 없다. */
  basis?: 'RF' | 'Earth LOS'
  unit: RequirementMargin['unit']
  /** 저장된 값이 없으면 null이다. 0으로 채우지 않는다. */
  value: number | null
}

type Site = Pick<Candidate, 'sun' | 'earth' | 'rf' | 'terrain'>

const percent = (fraction: number | null | undefined) =>
  fraction == null ? null : fraction * 100

/**
 * 저장된 탐색 결과에서 후보의 지표 여섯 개를 패널에 보이는 순서로 낸다.
 * RF 탐색이면 통신 지표를 지구 LOS가 아니라 명목 RF 값으로 본다 (requirementMargins와 같은 규칙).
 */
export function siteMetrics(
  site: Site,
  config: Pick<SearchConfig, 'rf'>,
): SiteMetric[] {
  const rf = config.rf != null
  const basis = rf ? 'RF' : 'Earth LOS'
  return [
    {
      key: 'sun',
      label: 'Sunlight',
      unit: '%',
      value: percent(site.sun.fraction),
    },
    {
      key: 'communication',
      label: 'Communication',
      basis,
      unit: '%',
      value: percent(rf ? site.rf?.fraction : site.earth.fraction),
    },
    {
      key: 'dark',
      label: 'Longest darkness',
      unit: 'h',
      value: site.sun.longest_dark_hours,
    },
    {
      key: 'blackout',
      label: 'Longest comm outage',
      basis,
      unit: 'h',
      value:
        (rf
          ? site.rf?.longest_blackout_hours
          : site.earth.longest_blackout_hours) ?? null,
    },
    {
      key: 'slope',
      label: 'Local slope',
      unit: '°',
      value: site.terrain?.slope_p95_deg ?? null,
    },
    {
      key: 'roughness',
      label: 'Local roughness',
      unit: 'm',
      value: site.terrain?.roughness_p95_m ?? null,
    },
  ]
}
