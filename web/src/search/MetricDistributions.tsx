import type { RunDetail } from '../api/candidates'
import { Distribution } from './Distribution'

const DISTRIBUTIONS = [
  {
    key: 'rf_fraction',
    title: 'RF 통신 가능 비율',
    englishTitle: 'Radio link availability',
    hint: 'LOS와 목표 링크마진을 모두 만족한 시간 비율',
    unit: 'fraction',
  },
  {
    key: 'rf_longest_blackout_h',
    title: 'RF 최장 두절',
    englishTitle: 'Longest RF blackout',
    hint: 'LOS 차폐와 마진 부족을 합한 최장 연속 두절',
    unit: 'hours',
  },
  {
    key: 'sun_fraction',
    title: '일조율',
    englishTitle: 'Sunlight',
    hint: '지점별 평균 일조율',
    unit: 'fraction',
  },
  {
    key: 'earth_fraction',
    title: '지구 가시율',
    englishTitle: 'Earth visibility',
    hint: '지점별 평균 지구 가시율',
    unit: 'fraction',
  },
  {
    key: 'sun_longest_dark_h',
    title: '최장 연속 암흑',
    englishTitle: 'Longest period of darkness',
    hint: '기간 중 가장 길었던 암흑(최악값)',
    unit: 'hours',
  },
  {
    key: 'earth_longest_blackout_h',
    title: '최장 지구 LOS 차폐',
    englishTitle: 'Longest loss of Earth visibility',
    hint: '지구 중심 방향이 지형에 가린 최장 시간',
    unit: 'hours',
  },
] as const

export function MetricDistributions({
  values,
  includeRF,
  english = false,
}: {
  values: RunDetail['summary']['distributions']
  includeRF: boolean
  english?: boolean
}) {
  return (
    <div
      role="region"
      aria-label={english ? 'Metric distributions' : '지표 분포'}
      tabIndex={0}
      className="grid max-h-[min(32dvh,16rem)] content-start gap-4 overflow-y-auto p-2 [scrollbar-gutter:stable] focus-visible:outline-sky-400"
    >
      {DISTRIBUTIONS.filter(
        (item) => !item.key.startsWith('rf_') || includeRF,
      ).map((item) => (
        <Distribution
          key={item.key}
          english={english}
          title={english ? item.englishTitle : item.title}
          hint={english ? '' : item.hint}
          values={values[item.key] ?? {}}
          unit={item.unit}
        />
      ))}
    </div>
  )
}
