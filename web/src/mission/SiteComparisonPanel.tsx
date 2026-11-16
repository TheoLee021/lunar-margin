import { useEffect, useRef } from 'react'
import type { Candidate, SearchConfig } from '../api/candidates'
import {
  bestValues,
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
const digits = (unit: string) => (unit === 'm' ? 2 : 1)
const amount = (value: number | null, unit: string) =>
  value === null
    ? '—'
    : `${value.toFixed(digits(unit))}${unit === 'h' || unit === 'dB' || unit === 'pp' ? ' ' + unit : unit}`
const marginText = (row: RequirementMargin) =>
  row.margin === null
    ? '—'
    : `${row.margin >= 0 ? '+' : ''}${amount(row.margin, row.unit === '%' ? 'pp' : row.unit)}`

/**
 * Compares the TOP 5 candidates' saved metrics. Which of them are compared is chosen here, apart
 * from the candidate selected on the map, which only changes through `onSelect`.
 */
export function SiteComparisonPanel({
  candidates,
  checkedIds,
  selectedId,
  config,
  onToggle,
  onSelect,
  onClose,
  onClear,
}: {
  /** Every candidate that can be compared, in rank order. */
  candidates: readonly Candidate[]
  /** The ones being compared. */
  checkedIds: readonly string[]
  /** The candidate selected on the map, if any. */
  selectedId: string | null
  config: SearchConfig
  onToggle: (id: string) => void
  /** Selects a candidate on the map and leaves the comparison. */
  onSelect: (id: string) => void
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
  const color = (candidate: Candidate) =>
    COMPARISON_COLORS[(candidate.rank - 1) % COMPARISON_COLORS.length]
  const entries = candidates
    .filter((candidate) => checkedIds.includes(candidate.id))
    .map((candidate) => ({
      candidate,
      color: color(candidate),
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
          TOP 5 candidate comparison
        </h2>
        <button
          type="button"
          className="hud-button"
          aria-label="Close comparison"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <p className="mt-2 text-xs text-neutral-400">
        {config.window.start.slice(0, 10)} → {config.window.end.slice(0, 10)}{' '}
        UTC · observer height {config.observer_height_m} m · same saved search
        result
      </p>
      <fieldset className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <legend className="sr-only">Candidates to compare</legend>
        {candidates.map((candidate) => (
          <label
            key={candidate.id}
            className="flex min-h-9 cursor-pointer items-center gap-2"
            style={{ color: color(candidate) }}
          >
            <input
              type="checkbox"
              aria-label={`Compare candidate ${candidate.rank}`}
              checked={checkedIds.includes(candidate.id)}
              onChange={() => onToggle(candidate.id)}
            />
            Candidate {candidate.rank}
          </label>
        ))}
      </fieldset>
      {entries.length === 0 ? (
        <p role="status" className="py-10 text-center text-sm text-neutral-300">
          Check candidates to compare their actual metrics.
        </p>
      ) : (
        <>
          <p className="mt-3 text-xs text-neutral-300">
            Further out is better for that metric. The area of a shape is not an
            overall score, safety rating or probability of success.
          </p>
          <ul
            aria-label="Compared candidates legend"
            className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs"
          >
            {entries.map(({ candidate, color }, index) => (
              <li key={candidate.id} style={{ color }}>
                <span aria-hidden="true">{index % 2 ? '┄' : '━'} </span>
                Candidate {candidate.rank}
                <span className="ml-1 text-neutral-400">
                  ({candidate.eligibility.status})
                </span>
              </li>
            ))}
          </ul>
          <svg
            role="img"
            aria-label="Radar of six metrics per candidate"
            viewBox="0 0 400 350"
            className="mx-auto w-full max-w-[480px]"
          >
            <title>
              Six metrics of the checked candidates compared. Actual values and
              scales are in the tables below.
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
                          Candidate {candidate.rank} · {axes[i]!.label}:{' '}
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
            Two or three candidates read best. Missing values show —, and a
            shape is not closed when terrain data is incomplete. RF link margin
            is the minimum nominal link margin computed over the mission.
            Longest Earth blackout is the longest continuous time terrain hides
            the Earth’s centre.
          </p>
          <div
            role="region"
            aria-label="Actual metrics table, scrolls horizontally"
            tabIndex={0}
            className="mt-4 overflow-x-auto rounded border border-white/10"
          >
            <table
              aria-label="Candidate actual metrics"
              className="w-full text-left text-xs"
            >
              <thead>
                <tr className="bg-white/5">
                  <th scope="col" className="min-w-36 p-3">
                    Metric · better direction
                  </th>
                  {entries.map(({ candidate, color }) => (
                    <th
                      key={candidate.id}
                      scope="col"
                      className="min-w-28 whitespace-nowrap p-3"
                      style={{ color }}
                    >
                      Candidate {candidate.rank}
                    </th>
                  ))}
                  <th scope="col" className="min-w-44 p-3">
                    Radar display range
                  </th>
                </tr>
              </thead>
              <tbody>
                {axes.map((axis, i) => {
                  // Compared as shown, so values that read the same are marked together.
                  const best = bestValues(
                    entries.map(({ values }) => {
                      const value = values[i]!.value
                      return value === null
                        ? null
                        : Number(value.toFixed(digits(axis.unit)))
                    }),
                    axis.higherIsBetter,
                  )
                  return (
                    <tr key={axis.key} className="border-t border-white/10">
                      <th scope="row" className="p-3 font-normal">
                        {axis.label} {axis.higherIsBetter ? '↑' : '↓'}
                      </th>
                      {entries.map(({ candidate, values }, entryIndex) => (
                        <td
                          key={candidate.id}
                          data-best={best[entryIndex] || undefined}
                          className="whitespace-nowrap p-3 font-mono data-best:font-semibold data-best:text-teal-300"
                        >
                          {amount(values[i]!.value, axis.unit)}
                        </td>
                      ))}
                      <td className="p-3 text-neutral-400">
                        {axis.referenceLabel}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/10">
                  <th scope="row" className="p-3 font-normal">
                    Select on map
                  </th>
                  {entries.map(({ candidate }) => (
                    <td key={candidate.id} className="p-3">
                      <button
                        type="button"
                        className="hud-button"
                        aria-current={selectedId === candidate.id}
                        onClick={() => onSelect(candidate.id)}
                      >
                        Select candidate {candidate.rank}
                      </button>
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">
            <span className="font-semibold text-teal-300">
              Highlighted values
            </span>{' '}
            are the most favourable for that metric among the compared
            candidates. Values beyond the display range are clipped on the radar
            but shown as they are in the table. Scales stay fixed whatever is
            checked.
          </p>
          {conditions.length ? (
            <div
              role="region"
              aria-label="Margin table, scrolls horizontally"
              tabIndex={0}
              className="mt-4 overflow-x-auto rounded border border-white/10"
            >
              <table
                aria-label="Candidate margins per condition"
                className="w-full text-left text-xs"
              >
                <caption className="p-3 text-left font-semibold text-neutral-200">
                  Margin per search condition · actual value against its limit
                </caption>
                <thead>
                  <tr className="bg-white/5">
                    <th scope="col" className="min-w-36 p-3">
                      Condition
                    </th>
                    <th scope="col" className="min-w-28 p-3">
                      Limit
                    </th>
                    {entries.map(({ candidate, color }) => (
                      <th
                        key={candidate.id}
                        scope="col"
                        className="min-w-28 p-3"
                        style={{ color }}
                      >
                        Candidate {candidate.rank} margin
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
              No mission limits were saved, so margins per condition are not
              shown.
            </p>
          )}
          <p className="mt-2 text-xs text-neutral-400">
            Positive margins are inside the limit, negative ones exceed it.
            Differences of ratios are in pp.{' '}
            {config.rf
              ? 'For RF searches the communication margins follow the nominal RF link. '
              : ''}
            No new ranking or eligibility is computed.
          </p>
        </>
      )}
      <footer className="mt-5 flex justify-between gap-3">
        <button type="button" className="hud-button" onClick={onClear}>
          Clear comparison selection
        </button>
        <button type="button" className="hud-button" onClick={onClose}>
          Close
        </button>
      </footer>
    </dialog>
  )
}
