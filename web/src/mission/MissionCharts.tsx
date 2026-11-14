import { BASE_DAY, iso } from './missionDates'
import type { DateScore } from './types'
import { AnalysisStatus } from './AnalysisStatus'
import type { MissionAnalysisResult } from './useMissionAnalysis'
import { MissionTimeline } from './MissionTimeline'

type Series = { x: number[]; y: number[]; color: string; dashed?: boolean }
type PlotProps = {
  title: string
  x0: number
  x1: number
  y0: number
  y1: number
  yTicks: number[]
  xTicks: number[]
  xLabel: (x: number) => string
  series: Series[]
  height?: number
  marker: number
  best?: { x: number; y: number }
  onSelect?: (x: number) => void
}
function Plot({
  title,
  x0,
  x1,
  y0,
  y1,
  yTicks,
  xTicks,
  xLabel,
  series,
  height = 90,
  marker,
  best,
  onSelect,
}: PlotProps) {
  const width = 580,
    left = 34,
    top = 10,
    right = 8,
    bottom = 22
  const iw = width - left - right,
    ih = height - top - bottom
  const X = (x: number) => left + ((x - x0) / (x1 - x0)) * iw
  const Y = (y: number) =>
    top + (1 - (Math.min(y1, Math.max(y0, y)) - y0) / (y1 - y0)) * ih
  const select = (x: number) => onSelect?.(Math.min(x1, Math.max(x0, x)))
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      {yTicks.map((y) => (
        <g key={y}>
          <line
            x1={left}
            x2={width - right}
            y1={Y(y)}
            y2={Y(y)}
            stroke="var(--line)"
          />
          <text
            x={left - 5}
            y={Y(y) + 4}
            textAnchor="end"
            fill="var(--muted)"
            fontSize="10"
          >
            {y}
          </text>
        </g>
      ))}
      {xTicks.map((x) => (
        <text
          key={x}
          x={X(x)}
          y={height - 6}
          textAnchor="middle"
          fill="var(--muted)"
          fontSize="10"
        >
          {xLabel(x)}
        </text>
      ))}
      {series.map((s, i) => (
        <polyline
          key={i}
          points={s.x
            .map((x, k) => `${X(x).toFixed(1)},${Y(s.y[k]).toFixed(1)}`)
            .join(' ')}
          fill="none"
          stroke={s.color}
          strokeWidth="1.6"
          strokeDasharray={s.dashed ? '3 3' : undefined}
        />
      ))}
      <line
        x1={X(marker)}
        x2={X(marker)}
        y1={top}
        y2={top + ih}
        stroke="var(--earth)"
        strokeDasharray="3 3"
      />
      {best ? (
        <text
          x={X(best.x)}
          y={Y(best.y) - 4}
          fill="var(--fg)"
          textAnchor="middle"
          fontSize="11"
        >
          ▲
        </text>
      ) : null}
      {onSelect ? (
        <rect
          x={left}
          y={top}
          width={iw}
          height={ih}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          role="slider"
          aria-label="그래프에서 착륙일 선택"
          aria-valuemin={x0}
          aria-valuemax={x1}
          aria-valuenow={marker}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault()
              select(marker + (e.key === 'ArrowLeft' ? -1 : 1))
            }
          }}
          onClick={(e) => {
            const bounds =
              e.currentTarget.ownerSVGElement!.getBoundingClientRect()
            select(
              x0 +
                ((((e.clientX - bounds.left) / bounds.width) * width - left) /
                  iw) *
                  (x1 - x0),
            )
          }}
        />
      ) : null}
    </svg>
  )
}
export function MissionCharts({
  score,
  live,
  hour,
  onLanding,
}: {
  live: MissionAnalysisResult
  score: DateScore | null
  hour: number
  onLanding: (date: string) => void
}) {
  if (!score)
    return (
      <div className="planner-charts">
        <section className="group">
          <h2>착륙지 분석</h2>
          <p className="hint">지형과 후보 지점을 불러오는 중입니다.</p>
        </section>
      </div>
    )
  const { xs, ys, day, duration } = score
  const best = ys.indexOf(Math.max(...ys)),
    ticks = [day - 60, day - 15, day + 30, day + 75, day + 120]
  return (
    <div className="planner-charts">
      <section className="group chart">
        <h2>착륙일별 점수</h2>
        <Plot
          title="착륙일별 예시 점수"
          x0={xs[0]}
          x1={xs[xs.length - 1]}
          y0={0}
          y1={100}
          yTicks={[0, 50, 100]}
          xTicks={ticks}
          xLabel={(x) => iso(x + BASE_DAY).slice(5)}
          height={170}
          marker={day}
          series={[{ x: xs, y: ys, color: 'var(--fg)' }]}
          best={{ x: xs[best], y: ys[best] }}
          onSelect={(x) => onLanding(iso(Math.round(x) + BASE_DAY))}
        />
        <p className="hint">
          선택한 착륙지의 날짜별 예시 점수. 곡선을 클릭해 착륙일을 비교하세요. ▲
          최고 점수.
        </p>
      </section>
      <section
        className="group chart mission-timeline-panel"
        aria-label="미션 기간 타임라인"
      >
        <div className="mission-timeline-heading">
          <h2>미션 기간 타임라인</h2>
          <span className="example-label">NASA 실제 분석</span>
        </div>
        {live.kind === 'ready' ? (
          <MissionTimeline
            key={`${live.data.sun.start}/${live.data.sun.end}/${live.data.sun.lat}/${live.data.sun.lon}`}
            timeline={live.data.timeline}
            duration={duration}
            hour={hour}
          />
        ) : (
          <AnalysisStatus result={live} />
        )}
      </section>
    </div>
  )
}
