import { useEffect, useRef } from 'react'
import type { Candidate, SearchConfig } from '../api/candidates'
import {
  comparisonAxes,
  comparisonValues,
  COMPARISON_COLORS,
} from './siteCompare'
import {
  requirementMargins,
  type RequirementMargin,
} from './requirementMargins'

const point = (index: number, radius: number) => {
  const angle = (index * Math.PI) / 3 - Math.PI / 2
  return [
    200 + Math.cos(angle) * radius * 120,
    175 + Math.sin(angle) * radius * 120,
  ] as const
}
const xy = (index: number, radius: number) =>
  point(index, radius)
    .map((n) => n.toFixed(2))
    .join(',')
const amount = (value: number | null, unit: string) =>
  value === null
    ? '—'
    : `${value.toFixed(unit === 'm' ? 2 : 1)}${unit === '시간' || unit === 'dB' ? ' ' + unit : unit}`
const marginText = (row: RequirementMargin) =>
  row.margin === null
    ? '—'
    : `${row.margin >= 0 ? '+' : ''}${amount(row.margin, row.unit === '%' ? '%p' : row.unit)}`

export function SiteComparisonPanel({
  candidates,
  config,
  onClose,
  onClear,
}: {
  candidates: readonly Candidate[]
  config: SearchConfig
  onClose: () => void
  onClear: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const axes = comparisonAxes(config)
  const entries = candidates.map((candidate) => ({
    candidate,
    color: COMPARISON_COLORS[(candidate.rank - 1) % COMPARISON_COLORS.length],
    values: comparisonValues(candidate, axes),
    margins: requirementMargins(
      {
        ...candidate,
        terrain:
          (candidate.terrain?.coverage_fraction ?? 0) >= 0.9999
            ? candidate.terrain
            : null,
      },
      config,
    ),
  }))
  const conditions = entries[0]?.margins ?? []
  return (
    <dialog
      ref={dialog}
      aria-labelledby="siteComparisonTitle"
      onCancel={onClose}
      className="m-auto max-h-[calc(100dvh-24px)] w-[min(900px,calc(100vw-24px))] max-w-none overflow-y-auto rounded-xl border border-white/20 bg-[#10151c] p-4 text-neutral-100 shadow-2xl backdrop:bg-black/70 sm:p-6"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 id="siteComparisonTitle" className="text-lg font-semibold">
          TOP 5 후보 비교
        </h2>
        <button
          type="button"
          className="hud-button"
          aria-label="비교 닫기"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <p className="mt-2 text-xs text-neutral-400">
        {config.window.start.slice(0, 10)} → {config.window.end.slice(0, 10)}{' '}
        UTC · 관측 높이 {config.observer_height_m} m · 동일한 저장 탐색 결과
      </p>
      {entries.length === 0 ? (
        <p role="status" className="py-10 text-center text-sm text-neutral-300">
          후보를 체크하면 실제 지표를 비교할 수 있습니다.
        </p>
      ) : (
        <>
          <p className="mt-3 text-xs text-neutral-300">
            바깥쪽일수록 해당 지표가 유리합니다. 도형 면적은 종합
            점수·안전성·성공 확률이 아닙니다.
          </p>
          <ul
            aria-label="비교 후보 범례"
            className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs"
          >
            {entries.map(({ candidate, color }, index) => (
              <li key={candidate.id} style={{ color }}>
                <span aria-hidden="true">{index % 2 ? '┄' : '━'} </span>후보{' '}
                {candidate.rank}
                <span className="ml-1 text-neutral-400">
                  ({candidate.eligibility.status})
                </span>
              </li>
            ))}
          </ul>
          <svg
            role="img"
            aria-label="후보별 여섯 지표 레이더"
            viewBox="0 0 400 350"
            className="mx-auto w-full max-w-[480px]"
          >
            <title>
              선택한 후보의 여섯 지표 비교. 실제 값과 척도는 아래 표에
              표시합니다.
            </title>
            {[0.25, 0.5, 0.75, 1].map((radius) => (
              <polygon
                key={radius}
                points={axes.map((_, i) => xy(i, radius)).join(' ')}
                fill="none"
                stroke="#334155"
                strokeWidth="1"
              />
            ))}
            {axes.map((axis, i) => {
              const [x, y] = point(i, 1.25)
              return (
                <g key={axis.key}>
                  <line
                    x1="200"
                    y1="175"
                    x2={point(i, 1)[0]}
                    y2={point(i, 1)[1]}
                    stroke="#334155"
                  />
                  <text
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#cbd5e1"
                    fontSize="11"
                  >
                    {axis.label}
                  </text>
                </g>
              )
            })}
            {entries.map(({ candidate, color, values }, entryIndex) => {
              const complete = values.every((value) => value.radius !== null)
              return (
                <g
                  key={candidate.id}
                  data-candidate={candidate.id}
                  stroke={color}
                  strokeWidth="2"
                  fill={color}
                >
                  {complete ? (
                    <polygon
                      data-candidate={candidate.id}
                      points={values
                        .map((value, i) => xy(i, value.radius!))
                        .join(' ')}
                      fillOpacity="0.04"
                      strokeDasharray={entryIndex % 2 ? '6 4' : undefined}
                    />
                  ) : (
                    values.map((value, i) => {
                      const next = values[(i + 1) % values.length]!
                      if (value.radius === null || next.radius === null)
                        return null
                      return (
                        <line
                          key={i}
                          x1={point(i, value.radius)[0]}
                          y1={point(i, value.radius)[1]}
                          x2={point((i + 1) % values.length, next.radius)[0]}
                          y2={point((i + 1) % values.length, next.radius)[1]}
                          strokeDasharray={entryIndex % 2 ? '6 4' : undefined}
                        />
                      )
                    })
                  )}
                  {values.map((value, i) =>
                    value.radius === null ? null : (
                      <circle
                        key={i}
                        cx={point(i, value.radius)[0]}
                        cy={point(i, value.radius)[1]}
                        r="3"
                      >
                        <title>
                          후보 {candidate.rank} · {axes[i]!.label}:{' '}
                          {amount(value.value, axes[i]!.unit)}
                        </title>
                      </circle>
                    ),
                  )}
                </g>
              )
            })}
          </svg>
          <p className="text-xs text-neutral-400">
            2~3개를 비교하면 읽기 쉽습니다. 결측은 —, 지형 자료가 불완전하면
            도형을 연결하지 않습니다. RF 링크 마진은 임무 기간에 계산한 명목
            링크 마진의 최솟값입니다. 최장 지구 차폐는 지형이 지구 중심을 가린
            연속 시간입니다.
          </p>
          <div
            role="region"
            aria-label="실제 지표 표 가로 스크롤"
            tabIndex={0}
            className="mt-4 overflow-x-auto rounded border border-white/10"
          >
            <table
              aria-label="후보 실제 지표"
              className="w-full text-left text-xs"
            >
              <thead>
                <tr className="bg-white/5">
                  <th scope="col" className="min-w-36 p-3">
                    지표 · 유리한 방향
                  </th>
                  {entries.map(({ candidate, color }) => (
                    <th
                      key={candidate.id}
                      scope="col"
                      className="min-w-28 whitespace-nowrap p-3"
                      style={{ color }}
                    >
                      후보 {candidate.rank}
                    </th>
                  ))}
                  <th scope="col" className="min-w-44 p-3">
                    레이더 표시 범위
                  </th>
                </tr>
              </thead>
              <tbody>
                {axes.map((axis, i) => (
                  <tr key={axis.key} className="border-t border-white/10">
                    <th scope="row" className="p-3 font-normal">
                      {axis.label} {axis.higherIsBetter ? '↑' : '↓'}
                    </th>
                    {entries.map(({ candidate, values }) => (
                      <td
                        key={candidate.id}
                        className="whitespace-nowrap p-3 font-mono"
                      >
                        {amount(values[i]!.value, axis.unit)}
                      </td>
                    ))}
                    <td className="p-3 text-neutral-400">
                      {axis.referenceLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">
            표시 범위를 넘는 값은 도형 끝에서 잘리지만 실제 수치는 표에 그대로
            표시합니다. 척도는 체크 선택과 무관하게 고정됩니다.
          </p>
          {conditions.length ? (
            <div
              role="region"
              aria-label="조건별 여유 표 가로 스크롤"
              tabIndex={0}
              className="mt-4 overflow-x-auto rounded border border-white/10"
            >
              <table
                aria-label="후보 조건별 여유"
                className="w-full text-left text-xs"
              >
                <caption className="p-3 text-left font-semibold text-neutral-200">
                  탐색 조건별 여유 · 실제 값과 한도의 차이
                </caption>
                <thead>
                  <tr className="bg-white/5">
                    <th scope="col" className="min-w-36 p-3">
                      조건
                    </th>
                    <th scope="col" className="min-w-28 p-3">
                      한도
                    </th>
                    {entries.map(({ candidate, color }) => (
                      <th
                        key={candidate.id}
                        scope="col"
                        className="min-w-28 p-3"
                        style={{ color }}
                      >
                        후보 {candidate.rank} 여유
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conditions.map((condition) => (
                    <tr
                      key={condition.key}
                      className="border-t border-white/10"
                    >
                      <th scope="row" className="p-3 font-normal">
                        {condition.label}
                      </th>
                      <td className="whitespace-nowrap p-3">
                        {condition.bound === 'min' ? '≥' : '≤'}{' '}
                        {amount(condition.limit, condition.unit)}
                      </td>
                      {entries.map(({ candidate, margins }) => {
                        const row = margins.find(
                          (value) => value.key === condition.key,
                        )
                        return (
                          <td
                            key={candidate.id}
                            className={`whitespace-nowrap p-3 font-mono ${row?.margin != null && row.margin < 0 ? 'text-red-300' : ''}`}
                          >
                            {row ? marginText(row) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-xs text-neutral-400">
              저장된 임무 한도가 없어 조건별 여유를 표시하지 않습니다.
            </p>
          )}
          <p className="mt-2 text-xs text-neutral-400">
            양수 여유는 한도 안쪽, 음수는 초과입니다. 비율의 차이는 %p입니다.{' '}
            {config.rf
              ? 'RF 탐색의 통신 조건 여유는 명목 RF 링크 기준입니다. '
              : ''}
            새로운 순위나 적격 판정을 계산하지 않습니다.
          </p>
        </>
      )}
      <footer className="mt-5 flex justify-between gap-3">
        <button type="button" className="hud-button" onClick={onClear}>
          비교 선택 모두 해제
        </button>
        <button type="button" className="hud-button" onClick={onClose}>
          닫기
        </button>
      </footer>
    </dialog>
  )
}
