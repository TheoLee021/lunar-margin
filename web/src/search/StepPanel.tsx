import type { RunDetail } from '../api/candidates'
import { STEPS } from './derive'
import { stepContent } from './stepCopy'

interface Props {
  index: number
  config: RunDetail['config']
  summary: RunDetail['summary']
  /** 이 단계의 레이어를 서버가 주지 않았을 때 알려 준다. */
  missingLayers: boolean
}

/** 지금 단계가 무엇을 하는지, 왜 하는지, 숫자는 얼마인지. */
export function StepPanel({ index, config, summary, missingLayers }: Props) {
  const step = STEPS[index]
  if (step === undefined) return null
  const content = stepContent(step.id, config, summary)
  return (
    <section
      id="step-panel"
      role="tabpanel"
      aria-labelledby={`step-tab-${step.id}`}
      className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5"
    >
      <h3 className="text-base font-semibold text-neutral-50">
        {content.title}
      </h3>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">
        <p className="text-neutral-200">
          <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-neutral-300">
            무엇을
          </span>
          {content.what}
        </p>
        <p className="text-neutral-400">
          <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-neutral-300">
            왜
          </span>
          {content.why}
        </p>
      </div>
      {missingLayers ? (
        <p
          role="note"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          이 실행에는 이 단계의 지도 레이어가 없습니다. 숫자만 확인할 수
          있습니다.
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-4 sm:grid-cols-2">
        {content.numbers.map((item) => (
          <div key={item.label}>
            <dt className="text-[11px] text-neutral-500">{item.label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-neutral-100">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
