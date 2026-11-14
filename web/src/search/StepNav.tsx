import { useRef, type KeyboardEvent } from 'react'
import { STEPS, type Metric } from './derive'

interface Props {
  index: number
  playing: boolean
  metric: Metric
  onIndexChange: (index: number) => void
  onTogglePlay: () => void
  onMetricChange: (metric: Metric) => void
}

const METRICS: readonly { value: Metric; label: string }[] = [
  { value: 'sun', label: '태양 일조' },
  { value: 'earth', label: '지구 가시성' },
]

/**
 * 탐색 과정을 6단계로 나눠 고르는 탭과 재생 조작.
 * 탭은 화살표·Home·End 키로 옮기고, 재생하면 일정 시간마다 다음 단계로 넘어간다.
 */
export function StepNav({
  index,
  playing,
  metric,
  onIndexChange,
  onTogglePlay,
  onMetricChange,
}: Props) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const last = STEPS.length - 1

  function move(next: number) {
    onIndexChange(next)
    tabs.current[next]?.focus()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') move(Math.min(index + 1, last))
    else if (event.key === 'ArrowLeft') move(Math.max(index - 1, 0))
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(last)
    else return
    event.preventDefault()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onIndexChange(Math.max(index - 1, 0))}
          disabled={index === 0}
          aria-label="이전 단계"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ◀ 이전
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          aria-pressed={playing}
          className="min-w-24 rounded-md bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-950 hover:bg-white"
        >
          {playing ? '⏸ 멈춤' : index === last ? '↺ 처음부터 재생' : '▶ 재생'}
        </button>
        <button
          type="button"
          onClick={() => onIndexChange(Math.min(index + 1, last))}
          disabled={index === last}
          aria-label="다음 단계"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          다음 ▶
        </button>
        <div
          role="group"
          aria-label="지도에 칠할 지표"
          className="ml-auto flex overflow-hidden rounded-md border border-neutral-700 text-xs"
        >
          {METRICS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={metric === item.value}
              onClick={() => onMetricChange(item.value)}
              className={`px-3 py-1.5 ${
                metric === item.value
                  ? 'bg-neutral-700 text-neutral-50'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="탐색 과정 단계"
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-1 sm:grid-cols-6"
      >
        {STEPS.map((step, i) => (
          <button
            key={step.id}
            ref={(node) => {
              tabs.current[i] = node
            }}
            type="button"
            role="tab"
            id={`step-tab-${step.id}`}
            aria-selected={i === index}
            aria-controls="step-panel"
            tabIndex={i === index ? 0 : -1}
            onClick={() => onIndexChange(i)}
            className={`flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-xs ${
              i === index
                ? 'border-neutral-300 bg-neutral-800 text-neutral-50'
                : i < index
                  ? 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600'
                  : 'border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
            }`}
          >
            <span className="text-[10px] tabular-nums text-neutral-500">
              {i + 1} / {STEPS.length}
            </span>
            <span className="font-medium">{step.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
