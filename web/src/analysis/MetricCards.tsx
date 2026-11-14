import type { Analysis, AnalysisKind } from '../api/analysis'
import { formatDuration, formatPercent, type Check } from './derive'
import { KIND_COPY } from './kinds'

function Card(props: {
  label: string
  value: string
  sub?: string | undefined
  hint: string
  valueClass: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <dt className="text-xs font-medium text-neutral-400">{props.label}</dt>
      <dd
        className={`text-3xl font-semibold tracking-tight ${props.valueClass}`}
      >
        {props.value}
      </dd>
      {props.sub ? (
        <p className="text-xs text-neutral-500">{props.sub}</p>
      ) : null}
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
        {props.hint}
      </p>
    </div>
  )
}

export function MetricCards(props: { kind: AnalysisKind; data: Analysis }) {
  const copy = KIND_COPY[props.kind]
  const { metrics } = props.data
  const third =
    props.kind === 'illumination'
      ? {
          value: `${metrics.windows_per_24h.toFixed(2)}회`,
          sub: `기간 전체 약 ${Math.round(metrics.windows_per_24h * daysBetween(props.data))}회`,
        }
      : {
          value:
            metrics.mean_elevation_deg === null
              ? '—'
              : `${metrics.mean_elevation_deg.toFixed(2)}°`,
          sub:
            metrics.mean_elevation_deg === null
              ? '지구가 보이는 시간이 없습니다'
              : '지구가 보이는 동안의 평균',
        }
  return (
    <dl className="grid gap-3 sm:grid-cols-3" aria-label="핵심 지표">
      <Card
        label={copy.fractionLabel}
        value={formatPercent(metrics.visible_fraction)}
        hint={copy.fractionHint}
        valueClass={copy.text}
      />
      <Card
        label={copy.darkLabel}
        value={formatDuration(metrics.longest_dark_hours)}
        sub={
          metrics.longest_dark_hours > 24
            ? `${metrics.longest_dark_hours.toFixed(1)}시간`
            : undefined
        }
        hint={copy.darkHint}
        valueClass={copy.text}
      />
      <Card
        label={copy.thirdLabel}
        value={third.value}
        sub={third.sub}
        hint={copy.thirdHint}
        valueClass={copy.text}
      />
    </dl>
  )
}

function daysBetween(data: Analysis): number {
  return (Date.parse(data.end) - Date.parse(data.start)) / 86_400_000
}

export function Verdict(props: { checks: readonly Check[] }) {
  const { checks } = props
  if (checks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-800 px-4 py-3 text-sm text-neutral-500">
        &lsquo;임무 기준&rsquo; 입력란에 값을 넣으면 이 지점이 기준을 만족하는지
        판정합니다.
      </p>
    )
  }
  const failed = checks.filter((check) => !check.pass)
  return (
    <section
      aria-label="임무 기준 판정"
      className={`rounded-lg border px-4 py-3 ${
        failed.length === 0
          ? 'border-emerald-500/40 bg-emerald-500/10'
          : 'border-red-500/40 bg-red-500/10'
      }`}
    >
      <p
        className={`text-sm font-semibold ${failed.length === 0 ? 'text-emerald-300' : 'text-red-300'}`}
      >
        {failed.length === 0
          ? '모든 기준을 만족합니다'
          : `기준 미충족: ${failed.map((check) => check.label).join(', ')}`}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {checks.map((check) => (
          <li key={check.id} className="flex gap-2 text-sm text-neutral-300">
            <span
              aria-hidden
              className={check.pass ? 'text-emerald-400' : 'text-red-400'}
            >
              {check.pass ? '✓' : '✗'}
            </span>
            <span>
              <span className="sr-only">
                {check.pass ? '충족: ' : '미충족: '}
              </span>
              {check.reason}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
