import { useState } from 'react'
import type { Analysis, AnalysisKind } from '../api/analysis'
import { evaluateThresholds, formatUtc, type Thresholds } from './derive'
import { KIND_COPY } from './kinds'
import { MetricCards, Verdict } from './MetricCards'
import { ElevationChart } from './ElevationChart'
import { PeriodsTable } from './PeriodsTable'
import { PolarPlot } from './PolarPlot'
import { TimelineStrip } from './TimelineStrip'

interface Props {
  kind: AnalysisKind
  data: Analysis
  thresholds: Thresholds
  /** 비교에 담는 기능이 필요 없는 곳(후보 상세 등)에서는 세 값을 모두 생략한다. */
  pinned?: boolean
  pinDisabled?: boolean
  onPin?: () => void
}

export function ResultView({
  kind,
  data,
  thresholds,
  pinned = false,
  pinDisabled = false,
  onPin,
}: Props) {
  const copy = KIND_COPY[kind]
  // 두 차트가 같은 시점을 가리키도록 hover 인덱스만 공유한다 (뷰어 상태 아님).
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const checks = evaluateThresholds(data.metrics, thresholds, {
    fraction: copy.fractionWord,
    dark: copy.darkWord,
  })

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">
            <span
              className={`mr-2 rounded-full px-2.5 py-0.5 text-xs ${copy.badge}`}
            >
              {copy.tab}
            </span>
            위도 {data.lat}° · 경도 {data.lon}°E
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            {formatUtc(data.start)} → {formatUtc(data.end)} · 간격{' '}
            {data.step_minutes}분 · 표본{' '}
            {data.series.times.length.toLocaleString()}개 · 관측 높이{' '}
            {data.observer_height_m} m
          </p>
        </div>
        {onPin ? (
          <button
            type="button"
            onClick={onPin}
            disabled={pinned || pinDisabled}
            className="rounded-md border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pinned
              ? '비교에 추가됨'
              : pinDisabled
                ? '비교는 최대 3개'
                : '비교에 추가'}
          </button>
        ) : null}
      </header>

      <MetricCards kind={kind} data={data} />
      <Verdict checks={checks} />

      {data.series.times.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">
          이 요청에 대한 시계열 데이터가 비어 있습니다.
        </p>
      ) : (
        <>
          <ElevationChart
            kind={kind}
            data={data}
            hoverIndex={hoverIndex}
            onHover={setHoverIndex}
          />
          <TimelineStrip kind={kind} data={data} hoverIndex={hoverIndex} />
          <PolarPlot kind={kind} data={data} hoverIndex={hoverIndex} />
        </>
      )}
      <PeriodsTable
        key={`${kind}-${data.lat}-${data.lon}-${data.start}-${data.end}`}
        kind={kind}
        data={data}
      />
    </div>
  )
}
