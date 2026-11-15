import type { RunDetail } from '../api/candidates'
import { allThresholdsNull, funnelSteps, reasonLabel } from './derive'
import { Distribution } from './Distribution'

interface Props {
  summary: RunDetail['summary']
  config: RunDetail['config']
}

const DISTRIBUTIONS = [
  {
    key: 'sun_fraction',
    title: '일조율',
    hint: '지점별 평균 일조율',
    unit: 'fraction',
  },
  {
    key: 'earth_fraction',
    title: '지구 가시율',
    hint: '지점별 평균 지구 가시율',
    unit: 'fraction',
  },
  {
    key: 'sun_longest_dark_h',
    title: '최장 연속 암흑',
    hint: '기간 중 가장 길었던 암흑(최악값)',
    unit: 'hours',
  },
  {
    key: 'earth_longest_blackout_h',
    title: '최장 통신 두절',
    hint: '기간 중 가장 길었던 두절(최악값)',
    unit: 'hours',
  },
] as const

/** 점이 단계마다 몇 개 남는지(퍼널), 탈락 사유, 지표 분포. */
export function FunnelPanel({ summary, config }: Props) {
  const steps = funnelSteps(summary.counts, summary.reasons)
  const top = steps[0]?.value ?? 0
  const reasons = Object.entries(summary.reasons)
    .filter(([, value]) => value > 0)
    .toSorted((a, b) => b[1] - a[1])
  const maxReason = reasons[0]?.[1] ?? 0
  const undecided = allThresholdsNull(config.thresholds)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="flex flex-col gap-5">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">
            점이 단계마다 몇 개 남나
          </h3>
          {steps.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">
              집계된 숫자가 없습니다.
            </p>
          ) : (
            <ol className="mt-3 flex flex-col gap-2">
              {steps.map((step) => (
                <li key={step.id} title={step.hint}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-neutral-300">{step.label}</span>
                    <span className="font-semibold tabular-nums text-neutral-100">
                      {step.value.toLocaleString('ko-KR')}개
                    </span>
                  </div>
                  <div aria-hidden className="mt-1 h-3 rounded-sm bg-white/10">
                    <div
                      className="h-full rounded-sm bg-sky-500/80"
                      style={{
                        width: `${top > 0 ? Math.max((step.value / top) * 100, step.value > 0 ? 0.8 : 0) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-neutral-100">탈락 사유</h3>
          <p className="mt-1 text-xs text-neutral-500">
            후보가 되지 못한 점이 왜 빠졌는지 사유별 개수입니다. 한 점이 여러
            사유에 걸릴 수 있습니다.
          </p>
          {reasons.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-sm text-neutral-500">
              기록된 탈락 사유가 없습니다.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {reasons.map(([key, value]) => (
                <li key={key}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-neutral-300">{reasonLabel(key)}</span>
                    <span className="tabular-nums text-neutral-100">
                      {value.toLocaleString('ko-KR')}개
                    </span>
                  </div>
                  <div aria-hidden className="mt-1 h-2 rounded-sm bg-white/10">
                    <div
                      className="h-full rounded-sm bg-amber-400/80"
                      style={{ width: `${(value / maxReason) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">지표 분포</h3>
          <p className="mt-1 text-xs text-neutral-500">
            계산한 모든 점의 분포입니다. 임계값을 정할 때 참고하세요.
          </p>
        </div>
        {undecided ? (
          <p
            role="note"
            className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-200"
          >
            임계값이 아직 정해지지 않았습니다. 그래서 계산에 성공한 모든 점이
            적격으로 처리됐습니다. 아래 분포를 보고 정한 뒤 다시 실행하세요.
          </p>
        ) : null}
        {DISTRIBUTIONS.map((item) => (
          <Distribution
            key={item.key}
            title={item.title}
            hint={item.hint}
            values={summary.distributions[item.key] ?? {}}
            unit={item.unit}
          />
        ))}
      </section>
    </div>
  )
}
