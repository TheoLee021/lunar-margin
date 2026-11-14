import { useMemo } from 'react'
import type { Analysis, AnalysisKind } from '../api/analysis'
import { decimateIndices, niceTicks, polarToXY } from './derive'
import { KIND_COPY, subject } from './kinds'
import { linePath, round1, scale } from './svg'

const SIZE = 440
const C = SIZE / 2
const R = 168
const MAX_POINTS = 700

interface Props {
  kind: AnalysisKind
  data: Analysis
  hoverIndex: number | null
}

// 하늘을 올려다본 모습: 북쪽이 위, 동쪽이 왼쪽. 중심이 높은 고도, 바깥쪽이 수평선 근처.
function sky(azimuthDeg: number, radius: number): [number, number] {
  const p = polarToXY(azimuthDeg, radius)
  return [C - p.x, C + p.y]
}

export function PolarPlot({ kind, data, hoverIndex }: Props) {
  const copy = KIND_COPY[kind]

  const model = useMemo(() => {
    const { horizon, series } = data
    let lo = Infinity
    let hi = -Infinity
    for (const e of horizon.elevation_deg) {
      lo = Math.min(lo, e)
      hi = Math.max(hi, e)
    }
    for (const e of series.body_elevation_deg) {
      lo = Math.min(lo, e)
      hi = Math.max(hi, e)
    }
    if (!Number.isFinite(lo)) {
      lo = -1
      hi = 1
    }
    const pad = Math.max(0.2, (hi - lo) * 0.06)
    lo -= pad
    hi += pad
    const radiusOf = (el: number) => scale(el, hi, lo, 0, R)

    const horizonPoints = horizon.azimuth_deg.map(
      (az, i) =>
        sky(az, radiusOf(horizon.elevation_deg[i] ?? 0)) as readonly [
          number,
          number,
        ],
    )
    const terrain = `M${C - R} ${C}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z${linePath(horizonPoints)}Z`
    const horizonOutline = `${linePath(horizonPoints)}Z`

    const indices = decimateIndices(series.times.length, MAX_POINTS)
    const dots = indices.map((i) => {
      const [px, py] = sky(
        series.body_azimuth_deg[i] ?? 0,
        radiusOf(series.body_elevation_deg[i] ?? 0),
      )
      return {
        i,
        x: round1(px),
        y: round1(py),
        visible: series.visible[i] ?? false,
      }
    })
    const rings = niceTicks(lo, hi, 4).map((tick) => ({
      tick,
      r: round1(radiusOf(tick)),
    }))
    return { terrain, horizonOutline, dots, rings, radiusOf }
  }, [data])

  const hovered =
    hoverIndex !== null && hoverIndex < data.series.times.length
      ? hoverIndex
      : null
  const hoverPoint =
    hovered === null
      ? null
      : sky(
          data.series.body_azimuth_deg[hovered] ?? 0,
          model.radiusOf(data.series.body_elevation_deg[hovered] ?? 0),
        )

  const compass: readonly (readonly [string, number])[] = [
    ['N', 0],
    ['E', 90],
    ['S', 180],
    ['W', 270],
  ]

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-neutral-200">
        방위각별 지형 수평선과 {copy.body}의 경로
        <span className="ml-2 text-xs font-normal text-neutral-500">
          하늘을 올려다본 모습 (북쪽 위, 동쪽 왼쪽). 회색 지형 위로 점이 나오면
          보이는 순간입니다.
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-950"
        role="img"
        aria-label={`방위각별 지형 수평선과 ${copy.body} 경로를 나타낸 하늘 도표`}
      >
        <circle cx={C} cy={C} r={R} className="fill-neutral-900" />
        {model.rings.map((ring) => (
          <g key={ring.tick}>
            <circle
              cx={C}
              cy={C}
              r={ring.r}
              fill="none"
              className="stroke-neutral-800"
            />
            <text
              x={C + 3}
              y={C - ring.r - 2}
              className="fill-neutral-600 text-[9px]"
            >
              {ring.tick}°
            </text>
          </g>
        ))}
        {Array.from({ length: 12 }, (_, i) => i * 30).map((az) => {
          const [x, y] = sky(az, R)
          return (
            <line
              key={az}
              x1={C}
              y1={C}
              x2={round1(x)}
              y2={round1(y)}
              className="stroke-neutral-800"
            />
          )
        })}
        <path
          d={model.terrain}
          fillRule="evenodd"
          className="fill-neutral-600/70"
        />
        <path
          d={model.horizonOutline}
          fill="none"
          className="stroke-neutral-300"
          strokeWidth={1.2}
        />
        {model.dots.map((dot) => (
          <circle
            key={dot.i}
            cx={dot.x}
            cy={dot.y}
            r={dot.visible ? 1.8 : 1.2}
            className={dot.visible ? copy.fill : 'fill-neutral-500'}
            opacity={dot.visible ? 0.95 : 0.55}
          />
        ))}
        {hoverPoint ? (
          <circle
            cx={round1(hoverPoint[0])}
            cy={round1(hoverPoint[1])}
            r={6}
            fill="none"
            className="stroke-white"
            strokeWidth={1.5}
          />
        ) : null}
        {compass.map(([label, az]) => {
          const [x, y] = sky(az, R + 14)
          return (
            <text
              key={label}
              x={round1(x)}
              y={round1(y) + 4}
              textAnchor="middle"
              className="fill-neutral-400 text-[12px] font-medium"
            >
              {label}
            </text>
          )
        })}
      </svg>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-neutral-400">
        <span className="inline-flex items-center gap-1.5">
          <span className={`inline-block size-2 rounded-full ${copy.bg}`} />
          {subject(copy.body)} 보임
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-neutral-500" />
          지형에 가려짐
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-neutral-600" />
          지형 (수평선 아래)
        </span>
      </div>
    </figure>
  )
}
