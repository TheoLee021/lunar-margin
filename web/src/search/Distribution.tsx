import { fractionText, hoursText } from './derive'

interface Props {
  english?: boolean
  title: string
  hint: string
  values: Readonly<Record<string, number>>
  /** 비율(0~1)이면 'fraction', 시간이면 'hours'. */
  unit: 'fraction' | 'hours'
}

const W = 320
const H = 34
const PAD = 6

/**
 * 분포를 상자 그림으로: 가는 선은 최소~최대, 옅은 막대는 10~90%, 진한 상자는 25~75%,
 * 흰 세로선은 중앙값이다. 값이 하나도 없으면 빈 상태를 보여 준다.
 */
export function Distribution({
  title,
  hint,
  values,
  unit,
  english = false,
}: Props) {
  const min = values['min']
  const max = values['max']
  const median = values['p50']
  if (min === undefined || max === undefined || median === undefined)
    return (
      <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-neutral-500">
        {title}: {english ? 'No data available.' : '값이 있는 점이 없습니다.'}
      </div>
    )
  const lo = unit === 'fraction' ? 0 : 0
  const hi = unit === 'fraction' ? 1 : Math.max(max, 1)
  const x = (value: number) =>
    PAD + ((value - lo) / (hi - lo || 1)) * (W - PAD * 2)
  const fmt =
    unit === 'fraction'
      ? fractionText
      : english
        ? (h: number) => `${Number(h.toFixed(1))} h`
        : hoursText
  const [low, mid, high] = english
    ? ['Min', 'Median', 'Max']
    : ['최소', '중앙값', '최대']
  const p10 = values['p10'] ?? min
  const p25 = values['p25'] ?? p10
  const p75 = values['p75'] ?? p25
  const p90 = values['p90'] ?? max
  const label = `${title}: ${low} ${fmt(min)}, ${mid} ${fmt(median)}, ${high} ${fmt(max)}`
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs text-neutral-300">
        {title}
        <span className="ml-2 text-neutral-500">{hint}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="w-full max-w-md"
      >
        <line
          x1={x(min)}
          x2={x(max)}
          y1={H / 2}
          y2={H / 2}
          stroke="#737373"
          strokeWidth={1}
        />
        <rect
          x={x(p10)}
          y={H / 2 - 5}
          width={Math.max(x(p90) - x(p10), 1)}
          height={10}
          rx={2}
          fill="#525252"
        />
        <rect
          x={x(p25)}
          y={H / 2 - 9}
          width={Math.max(x(p75) - x(p25), 1)}
          height={18}
          rx={2}
          fill="#38bdf8"
          fillOpacity={0.55}
          stroke="#7dd3fc"
        />
        <line
          x1={x(median)}
          x2={x(median)}
          y1={H / 2 - 11}
          y2={H / 2 + 11}
          stroke="white"
          strokeWidth={2}
        />
      </svg>
      <div className="flex max-w-md justify-between text-[11px] tabular-nums text-neutral-500">
        <span>
          {low} {fmt(min)}
        </span>
        <span className="text-neutral-300">
          {mid} {fmt(median)}
        </span>
        <span>
          {high} {fmt(max)}
        </span>
      </div>
    </figure>
  )
}
