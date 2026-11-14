import { useMemo, type KeyboardEvent, type PointerEvent } from 'react'
import type { Analysis, AnalysisKind } from '../api/analysis'
import {
  decimateIndices,
  horizonAtAzimuth,
  nearestIndex,
  niceTicks,
} from './derive'
import { KIND_COPY } from './kinds'
import { linePath, round1, scale } from './svg'

const W = 900
const H = 300
const M = { l: 48, r: 16, t: 16, b: 30 }
const MAX_POINTS = 1200

interface Props {
  kind: AnalysisKind
  data: Analysis
  hoverIndex: number | null
  onHover: (index: number | null) => void
}

function tickLabel(ms: number, spanMs: number): string {
  const iso = new Date(ms).toISOString()
  return spanMs < 3 * 86_400_000 ? iso.slice(11, 16) : iso.slice(5, 10)
}

export function ElevationChart({ kind, data, hoverIndex, onHover }: Props) {
  const copy = KIND_COPY[kind]
  const { series } = data

  const model = useMemo(() => {
    const timeMs = series.times.map((t) => Date.parse(t))
    const horizonAtBody = series.body_azimuth_deg.map((az) =>
      horizonAtAzimuth(data.horizon, az),
    )
    const tMin = timeMs[0] ?? 0
    const tMax = Math.max(timeMs.at(-1) ?? 0, Date.parse(data.end))
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < timeMs.length; i += 1) {
      lo = Math.min(
        lo,
        series.body_elevation_deg[i] ?? 0,
        horizonAtBody[i] ?? 0,
      )
      hi = Math.max(
        hi,
        series.body_elevation_deg[i] ?? 0,
        horizonAtBody[i] ?? 0,
      )
    }
    if (!Number.isFinite(lo)) {
      lo = -1
      hi = 1
    }
    const pad = Math.max(0.2, (hi - lo) * 0.08)
    const yMin = Math.min(lo - pad, -0.2)
    const yMax = Math.max(hi + pad, 0.2)
    const x = (ms: number) => scale(ms, tMin, tMax, M.l, W - M.r)
    const y = (deg: number) => scale(deg, yMin, yMax, H - M.b, M.t)
    const indices = decimateIndices(timeMs.length, MAX_POINTS)
    const body = linePath(
      indices.map((i) => [
        x(timeMs[i] ?? 0),
        y(series.body_elevation_deg[i] ?? 0),
      ]),
    )
    const horizonLine = linePath(
      indices.map((i) => [x(timeMs[i] ?? 0), y(horizonAtBody[i] ?? 0)]),
    )
    const spans = data.windows.map((w) => {
      const x0 = x(Date.parse(w.start))
      const x1 = x(Date.parse(w.end))
      return {
        x: round1(x0),
        width: Math.max(round1(x1 - x0), 1),
        key: w.start,
      }
    })
    const yTicks = niceTicks(yMin, yMax, 5)
    const xTicks = Array.from(
      { length: 6 },
      (_, i) => tMin + ((tMax - tMin) * i) / 5,
    )
    return {
      timeMs,
      horizonAtBody,
      tMin,
      tMax,
      yMin,
      yMax,
      x,
      y,
      body,
      horizonLine,
      spans,
      yTicks,
      xTicks,
    }
  }, [series, data.horizon, data.windows, data.end])

  const count = series.times.length

  function indexFromPointer(event: PointerEvent<SVGRectElement>): number {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const vx = ((event.clientX - rect.left) / rect.width) * W
    const t = scale(vx, M.l, W - M.r, model.tMin, model.tMax)
    return nearestIndex(model.timeMs, t)
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (count === 0) return
    const stride = event.shiftKey ? 10 : 1
    const current = hoverIndex ?? 0
    if (event.key === 'ArrowRight') {
      onHover(Math.min(count - 1, current + stride))
    } else if (event.key === 'ArrowLeft') {
      onHover(Math.max(0, current - stride))
    } else if (event.key === 'Escape') {
      onHover(null)
    } else {
      return
    }
    event.preventDefault()
  }

  const hovered = hoverIndex !== null && hoverIndex < count ? hoverIndex : null
  const hx = hovered === null ? 0 : model.x(model.timeMs[hovered] ?? 0)
  const hoverElevation =
    hovered === null ? 0 : (series.body_elevation_deg[hovered] ?? 0)
  const hoverHorizon =
    hovered === null ? 0 : (model.horizonAtBody[hovered] ?? 0)
  const margin = hoverElevation - hoverHorizon

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-neutral-200">
        {copy.body} 고도 vs 지형 수평선
        <span className="ml-2 text-xs font-normal text-neutral-500">
          {copy.body} 선이 수평선 선보다 위에 있는 동안({copy.windowLabel})은
          초록 배경입니다.
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-pan-y rounded-lg border border-neutral-800 bg-neutral-950 focus-visible:outline-2 focus-visible:outline-neutral-400"
        role="img"
        aria-label={`${copy.body} 고도와 수평선 고도의 시간 변화 차트. 좌우 방향키로 시점을 이동합니다.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {model.yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={M.l}
              x2={W - M.r}
              y1={round1(model.y(tick))}
              y2={round1(model.y(tick))}
              className={
                tick === 0 ? 'stroke-neutral-600' : 'stroke-neutral-800'
              }
            />
            <text
              x={M.l - 6}
              y={round1(model.y(tick)) + 3}
              textAnchor="end"
              className="fill-neutral-500 text-[10px]"
            >
              {tick}°
            </text>
          </g>
        ))}
        {model.xTicks.map((tick) => (
          <text
            key={tick}
            x={round1(model.x(tick))}
            y={H - 10}
            textAnchor="middle"
            className="fill-neutral-500 text-[10px]"
          >
            {tickLabel(tick, model.tMax - model.tMin)}
          </text>
        ))}
        {model.spans.map((span) => (
          <rect
            key={span.key}
            x={span.x}
            y={M.t}
            width={span.width}
            height={H - M.t - M.b}
            className="fill-emerald-500/15"
          />
        ))}
        <path
          d={model.horizonLine}
          fill="none"
          className="stroke-neutral-400"
          strokeWidth={1.2}
          strokeDasharray="4 3"
        />
        <path
          d={model.body}
          fill="none"
          className={copy.stroke}
          strokeWidth={1.6}
        />
        {hovered !== null ? (
          <g>
            <line
              x1={round1(hx)}
              x2={round1(hx)}
              y1={M.t}
              y2={H - M.b}
              className="stroke-neutral-300"
              strokeWidth={0.8}
            />
            <circle
              cx={round1(hx)}
              cy={round1(model.y(hoverElevation))}
              r={3.5}
              className={copy.fill}
            />
            <circle
              cx={round1(hx)}
              cy={round1(model.y(hoverHorizon))}
              r={3}
              className="fill-neutral-300"
            />
          </g>
        ) : null}
        <rect
          x={M.l}
          y={M.t}
          width={W - M.l - M.r}
          height={H - M.t - M.b}
          fill="transparent"
          onPointerMove={(event) => onHover(indexFromPointer(event))}
          onPointerDown={(event) => onHover(indexFromPointer(event))}
          onPointerLeave={() => onHover(null)}
        />
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-400">
        <span className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-0.5 w-5 ${copy.bg}`} />
          {copy.body} 고도
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 border-t border-dashed border-neutral-400" />
          그 방위각의 지형 수평선
        </span>
      </div>
      <p
        aria-live="off"
        className="min-h-10 rounded-md bg-neutral-900/60 px-3 py-2 text-xs text-neutral-300"
      >
        {hovered === null ? (
          '차트 위에 마우스를 올리거나 방향키(←/→, Shift로 빠르게)로 시점별 값을 확인하세요.'
        ) : (
          <>
            <span className="font-medium">
              {series.times[hovered]?.slice(0, 16).replace('T', ' ')} UTC
            </span>
            {' · '}방위각 {(series.body_azimuth_deg[hovered] ?? 0).toFixed(1)}°
            {' · '}
            {copy.body} 고도 {hoverElevation.toFixed(2)}°{' · '}수평선{' '}
            {hoverHorizon.toFixed(2)}°{' · '}여유 {margin >= 0 ? '+' : ''}
            {margin.toFixed(2)}°{' · '}
            <span
              className={
                series.visible[hovered]
                  ? 'text-emerald-400'
                  : 'text-neutral-500'
              }
            >
              {series.visible[hovered] ? '보임' : '지형에 가려짐'}
            </span>
          </>
        )}
      </p>
    </figure>
  )
}
