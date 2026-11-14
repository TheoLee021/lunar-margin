import { formatPercent } from '../analysis/derive'
import { AnalysisStatus } from './AnalysisStatus'
import type { MissionAnalysisResult } from './useMissionAnalysis'

export function MissionMetrics({ result }: { result: MissionAnalysisResult }) {
  if (result.kind !== 'ready') return <AnalysisStatus result={result} />
  if (result.data.timeline.t.length === 0)
    return (
      <p role="status" className="text-xs text-neutral-400">
        선택한 기간의 분석 표본이 없습니다.
      </p>
    )
  const { sun, earth } = result.data
  const metrics = [
    ['일조율', formatPercent(sun.metrics.visible_fraction)],
    ['지구 가시율', formatPercent(earth.metrics.visible_fraction)],
    ['최장 연속 어둠', `${sun.metrics.longest_dark_hours.toFixed(1)} 시간`],
    ['최장 지구 차폐', `${earth.metrics.longest_dark_hours.toFixed(1)} 시간`],
  ]
  return (
    <>
      <dl className="grid grid-cols-2 gap-2" aria-label="실제 분석 지표">
        {metrics.map(([label, value]) => (
          <div
            key={label}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
          >
            <dt className="text-xs text-neutral-400">{label}</dt>
            <dd className="font-mono text-lg">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-neutral-400">
        {sun.start.slice(0, 10)} → {sun.end.slice(0, 10)} UTC
        <br />
        NASA LOLA·SPICE 계산 · {sun.step_minutes}분 간격 · 관측 높이{' '}
        {sun.observer_height_m} m<br />
        지구 가시율은 지형 차폐 기준이며 통신 품질을 뜻하지 않습니다.
      </p>
    </>
  )
}
