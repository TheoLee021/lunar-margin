import {
  evaluateThresholds,
  formatDuration,
  formatPercent,
  formatUtc,
  type Thresholds,
} from './derive'
import { KIND_COPY } from './kinds'
import type { Pinned } from './pins'

interface Props {
  pins: readonly Pinned[]
  thresholds: Thresholds
  onRemove: (id: string) => void
  onClear: () => void
}

type Better = 'high' | 'low'

function best(values: readonly number[], better: Better): number | null {
  if (values.length < 2) return null
  return better === 'high' ? Math.max(...values) : Math.min(...values)
}

export function ComparePanel({ pins, thresholds, onRemove, onClear }: Props) {
  if (pins.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
        분석 결과에서 &lsquo;비교에 추가&rsquo;를 누르면 최대 3개 지점을 나란히
        비교할 수 있습니다.
      </p>
    )
  }
  // 종류가 섞이면 "더 좋음" 표시는 하지 않는다.
  const sameKind = pins.every((pin) => pin.kind === pins[0]?.kind)
  const hasChecks = Object.keys(thresholds).length > 0

  const rows: readonly {
    label: string
    better: Better | null
    value: (pin: Pinned) => number | null
    format: (value: number | null) => string
  }[] = [
    {
      label: '평균 일조율 · 지구 가시율',
      better: 'high',
      value: (pin) => pin.data.metrics.visible_fraction,
      format: (v) => (v === null ? '—' : formatPercent(v)),
    },
    {
      label: '최장 연속 암흑 · 통신 두절',
      better: 'low',
      value: (pin) => pin.data.metrics.longest_dark_hours,
      format: (v) => (v === null ? '—' : formatDuration(v)),
    },
    {
      label: '24시간당 창 횟수',
      better: 'high',
      value: (pin) => pin.data.metrics.windows_per_24h,
      format: (v) => (v === null ? '—' : `${v.toFixed(2)}회`),
    },
    {
      label: '보이는 동안 평균 고도각',
      better: 'high',
      value: (pin) => pin.data.metrics.mean_elevation_deg,
      format: (v) => (v === null ? '—' : `${v.toFixed(2)}°`),
    },
  ]

  return (
    <section className="flex flex-col gap-3" aria-label="지점 비교">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-200">
          지점 비교 ({pins.length}/3)
        </h3>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-neutral-400 hover:text-neutral-100"
        >
          모두 지우기
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full min-w-lg text-left text-sm">
          <thead className="bg-neutral-900 text-xs text-neutral-400">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">지표</span>
              </th>
              {pins.map((pin) => (
                <th
                  key={pin.id}
                  scope="col"
                  className="px-3 py-2 align-top font-medium"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${KIND_COPY[pin.kind].badge}`}
                  >
                    {KIND_COPY[pin.kind].tab}
                  </span>
                  <div className="mt-1 text-neutral-200">
                    {pin.data.lat}°, {pin.data.lon}°E
                  </div>
                  <div className="text-[11px] font-normal text-neutral-500">
                    {formatUtc(pin.data.start).slice(0, 10)} →{' '}
                    {formatUtc(pin.data.end).slice(0, 10)}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(pin.id)}
                    className="mt-1 text-[11px] font-normal text-neutral-500 hover:text-red-300"
                  >
                    제거
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {rows.map((row) => {
              const values = pins.flatMap((pin) => {
                const v = row.value(pin)
                return v === null ? [] : [v]
              })
              const winner =
                sameKind && row.better ? best(values, row.better) : null
              return (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="px-3 py-2 text-xs font-normal text-neutral-400"
                  >
                    {row.label}
                  </th>
                  {pins.map((pin) => {
                    const v = row.value(pin)
                    const isBest = winner !== null && v === winner
                    return (
                      <td
                        key={pin.id}
                        className={`px-3 py-2 tabular-nums ${isBest ? 'font-semibold text-emerald-300' : 'text-neutral-200'}`}
                      >
                        {row.format(v)}
                        {isBest ? (
                          <span className="sr-only"> (가장 좋음)</span>
                        ) : null}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {hasChecks ? (
              <tr>
                <th
                  scope="row"
                  className="px-3 py-2 text-xs font-normal text-neutral-400"
                >
                  임무 기준 판정
                </th>
                {pins.map((pin) => {
                  const pinCopy = KIND_COPY[pin.kind]
                  const failed = evaluateThresholds(
                    pin.data.metrics,
                    thresholds,
                    { fraction: pinCopy.fractionWord, dark: pinCopy.darkWord },
                  ).filter((check) => !check.pass)
                  return (
                    <td key={pin.id} className="px-3 py-2 text-xs">
                      {failed.length === 0 ? (
                        <span className="text-emerald-300">✓ 모두 충족</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5 text-red-300">
                          {failed.map((check) => (
                            <li key={check.id}>✗ {check.reason}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  )
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!sameKind ? (
        <p className="text-[11px] text-neutral-500">
          서로 다른 종류(일조/지구 가시성)가 섞여 있어 &lsquo;가장 좋음&rsquo;
          표시는 생략했습니다.
        </p>
      ) : null}
    </section>
  )
}
