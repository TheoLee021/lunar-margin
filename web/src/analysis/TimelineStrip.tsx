import { useMemo } from 'react'
import type { Analysis, AnalysisKind } from '../api/analysis'
import {
  durationHours,
  formatDuration,
  formatUtc,
  longestPeriod,
} from './derive'
import { KIND_COPY, subject } from './kinds'
import { round1, scale } from './svg'

const W = 900
const H = 56
const PAD = 8

interface Props {
  kind: AnalysisKind
  data: Analysis
  hoverIndex: number | null
}

export function TimelineStrip({ kind, data, hoverIndex }: Props) {
  const copy = KIND_COPY[kind]
  const t0 = Date.parse(data.start)
  const t1 = Date.parse(data.end)
  const x = (ms: number) => scale(ms, t0, t1, PAD, W - PAD)

  const longest = useMemo(
    () => longestPeriod(data.dark_periods),
    [data.dark_periods],
  )
  const ticks = Array.from({ length: 6 }, (_, i) => t0 + ((t1 - t0) * i) / 5)
  const hoverTime =
    hoverIndex === null ? null : Date.parse(data.series.times[hoverIndex] ?? '')

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-neutral-200">
        {copy.windowLabel}와 {copy.darkPeriodLabel} 타임라인
        <span className="ml-2 text-xs font-normal text-neutral-500">
          초록 = {copy.windowLabel}, 어두운 부분 = {copy.darkPeriodLabel}, 빨간
          테두리 = 가장 긴 구간
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg border border-neutral-800 bg-neutral-950"
        role="img"
        aria-label={`${copy.windowLabel} ${data.windows.length}개, ${copy.darkPeriodLabel} ${data.dark_periods.length}개`}
      >
        <rect
          x={PAD}
          y={8}
          width={W - 2 * PAD}
          height={24}
          className="fill-neutral-800"
          rx={3}
        />
        {data.windows.map((period) => (
          <rect
            key={period.start}
            x={round1(x(Date.parse(period.start)))}
            y={8}
            width={Math.max(
              round1(x(Date.parse(period.end)) - x(Date.parse(period.start))),
              1,
            )}
            height={24}
            className="fill-emerald-500"
          >
            <title>
              {copy.windowLabel}: {formatUtc(period.start)} →{' '}
              {formatUtc(period.end)} ({formatDuration(durationHours(period))})
            </title>
          </rect>
        ))}
        {longest ? (
          <rect
            x={round1(x(Date.parse(longest.start)))}
            y={6}
            width={Math.max(
              round1(x(Date.parse(longest.end)) - x(Date.parse(longest.start))),
              2,
            )}
            height={28}
            fill="none"
            className="stroke-red-500"
            strokeWidth={2}
            rx={3}
          >
            <title>
              가장 긴 {copy.darkPeriodLabel}: {formatUtc(longest.start)} →{' '}
              {formatUtc(longest.end)} ({formatDuration(durationHours(longest))}
              )
            </title>
          </rect>
        ) : null}
        {hoverTime !== null && Number.isFinite(hoverTime) ? (
          <line
            x1={round1(x(hoverTime))}
            x2={round1(x(hoverTime))}
            y1={4}
            y2={36}
            className="stroke-neutral-100"
            strokeWidth={1}
          />
        ) : null}
        {ticks.map((tick, i) => (
          <text
            key={tick}
            x={round1(x(tick))}
            y={50}
            textAnchor={
              i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'
            }
            className="fill-neutral-500 text-[10px]"
          >
            {new Date(tick).toISOString().slice(5, 10)}
          </text>
        ))}
      </svg>
      {data.windows.length === 0 ? (
        <p className="text-xs text-amber-300">
          이 기간에는 {subject(copy.windowLabel)} 한 번도 없습니다 (
          {subject(copy.body)} 계속 지형에 가려집니다).
        </p>
      ) : null}
      {longest ? (
        <p className="text-xs text-neutral-400">
          가장 긴 {copy.darkPeriodLabel}:{' '}
          <span className="text-red-300">
            {formatUtc(longest.start)} → {formatUtc(longest.end)} (
            {formatDuration(durationHours(longest))})
          </span>
        </p>
      ) : (
        <p className="text-xs text-emerald-300">
          이 기간에는 {subject(copy.darkPeriodLabel)} 없습니다.
        </p>
      )}
    </figure>
  )
}
