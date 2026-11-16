import { useId, useMemo, type ReactNode } from 'react'
import { nearestIndex, niceTicks } from '../analysis/derive'
import type { Timeline } from './types'
import './mission-timeline.css'

function timeLabel(day: number) {
  const minutes = Math.round(day * 1440)
  return `D+${Math.floor(minutes / 1440)} ${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
const degrees = (value: number) =>
  `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}°`

export function MissionTimeline({
  timeline: tl,
  duration,
  reviewed,
  onReview,
  observerHeightM = 0,
  children,
}: {
  timeline: Timeline
  duration: number
  /** The sample under review: an index into the timeline. */
  reviewed: number
  onReview: (index: number) => void
  observerHeightM?: number
  /** Controls shown under the review slider. */
  children?: ReactNode
}) {
  const patternId = useId()
  const geometry = useMemo(() => {
    const values = [...tl.sunEl, ...tl.earthEl, ...tl.sunHz, ...tl.earthHz]
    let low = 0,
      high = 0
    for (const v of values) {
      low = Math.min(low, v)
      high = Math.max(high, v)
    }
    const padding = Math.max(0.5, (high - low) * 0.1)
    const min = low - padding,
      max = high + padding
    // At most 1,344 samples for 28 days; keep all points, including short terrain peaks.
    return { min, max, ticks: niceTicks(min, max, 6) }
  }, [tl])
  if (tl.t.length === 0)
    return <p className="hint">No analysis samples in the selected period.</p>
  const selected = Math.min(tl.t.length - 1, Math.max(0, reviewed))
  const width = 580,
    left = 43,
    plotWidth = 523,
    plotTop = 68,
    plotHeight = 145
  const X = (time: number) => left + (time / duration) * plotWidth
  const Y = (value: number) =>
    plotTop +
    (1 - (value - geometry.min) / (geometry.max - geometry.min)) * plotHeight
  const series = [
    {
      key: 'sun',
      title: 'Sun',
      header: 20,
      bar: 245,
      color: 'var(--sun)',
      values: tl.sunEl,
      cutoff: tl.sunHz,
      visible: tl.sunVis,
      segments: tl.sunPeriods,
      yes: 'Sunlit',
      no: 'No sunlight',
      barTitle: 'Sunlight',
    },
    {
      key: 'earth',
      title: 'Earth',
      header: 42,
      bar: 292,
      color: 'var(--earth)',
      values: tl.earthEl,
      cutoff: tl.earthHz,
      visible: tl.earthVis,
      segments: tl.earthPeriods,
      yes: 'Earth visible',
      no: 'Earth blocked',
      barTitle: 'Earth visibility',
    },
  ]
  return (
    <>
      <div className="mission-timeline-guide">
        <span>Solid bar = visible</span>
        <span className="timeline-blocked-key">Hatched = blocked</span>
      </div>
      <svg
        className="unified-timeline"
        viewBox={`0 0 ${width} 345`}
        role="img"
        aria-label="Timeline of elevation with sunlight and Earth visibility"
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          const time = Math.min(
            duration,
            Math.max(
              0,
              ((((event.clientX - bounds.left) / bounds.width) * width - left) /
                plotWidth) *
                duration,
            ),
          )
          onReview(nearestIndex(tl.t, time))
        }}
      >
        <defs>
          <pattern
            id={patternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--muted)"
              strokeOpacity=".35"
              strokeWidth="2"
            />
          </pattern>
        </defs>
        <text x="0" y="61" fill="var(--muted)" fontSize="9">
          Elevation (°)
        </text>
        {geometry.ticks.map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={left + plotWidth}
              y1={Y(value)}
              y2={Y(value)}
              stroke={value === 0 ? 'var(--muted)' : 'var(--line)'}
              strokeOpacity={value === 0 ? 0.5 : 1}
            />
            <text
              x={left - 8}
              y={Y(value) + 3}
              textAnchor="end"
              fill="var(--muted)"
              fontSize="10"
            >
              {value}
            </text>
          </g>
        ))}
        {series.map((s) => {
          return (
            <g key={s.key}>
              <text
                x="0"
                y={s.header}
                fill={s.color}
                fontSize="13"
                fontWeight="500"
              >
                {s.title} {degrees(s.values[selected])} ·{' '}
                {s.visible[selected] ? s.yes : s.no}
              </text>
              <text
                x={width - 14}
                y={s.header}
                fill="var(--muted)"
                fontSize="9"
                textAnchor="end"
              >
                {s.key === 'sun'
                  ? 'Solid: Sun / dashed: terrain horizon'
                  : 'Solid: Earth / dashed: terrain horizon'}
              </text>
              <polyline
                points={tl.t
                  .map(
                    (t, i) => `${X(t).toFixed(2)},${Y(s.cutoff[i]).toFixed(2)}`,
                  )
                  .join(' ')}
                fill="none"
                stroke={s.color}
                strokeOpacity=".5"
                strokeWidth="1.3"
                strokeDasharray="4 3"
              />
              <polyline
                points={tl.t
                  .map(
                    (t, i) => `${X(t).toFixed(2)},${Y(s.values[i]).toFixed(2)}`,
                  )
                  .join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth="2.4"
              />
              <circle
                cx={X(tl.t[selected])}
                cy={Y(s.values[selected])}
                r="4"
                fill={s.color}
                stroke="var(--fg)"
                strokeWidth="1.4"
              />
              <text x={left} y={s.bar - 7} fill="var(--fg)" fontSize="11">
                {s.barTitle}
              </text>
              {s.segments.map((segment) => {
                const w = X(segment.end) - X(segment.start)
                return (
                  <g key={segment.start}>
                    <rect
                      x={X(segment.start)}
                      y={s.bar}
                      width={w}
                      height="24"
                      fill={segment.on ? s.color : `url(#${patternId})`}
                      stroke={segment.on ? s.color : 'var(--muted)'}
                      strokeWidth=".6"
                    />
                    <text
                      x={X(segment.start) + w / 2}
                      y={s.bar + 16}
                      textAnchor="middle"
                      fill={segment.on ? 'var(--bg)' : 'var(--fg)'}
                      fontSize="11"
                    >
                      {w > 64
                        ? segment.on
                          ? s.yes
                          : s.no
                        : segment.on
                          ? '●'
                          : '×'}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
        <line
          x1={X(tl.t[selected])}
          x2={X(tl.t[selected])}
          y1="65"
          y2="317"
          stroke="var(--fg)"
          strokeOpacity=".7"
          strokeDasharray="2 3"
        />
        {Array.from({ length: 8 }, (_, i) => (duration * i) / 7).map((t) => (
          <text
            key={t}
            x={X(t)}
            y="340"
            textAnchor="middle"
            fill="var(--muted)"
            fontSize="10"
          >
            D+{Number(t.toFixed(1))}
          </text>
        ))}
      </svg>
      <div className="timeline-inspection">
        <label htmlFor="timeline-inspection">Review time</label>
        <output htmlFor="timeline-inspection">
          {timeLabel(tl.t[selected])} ·{' '}
          {new Date(Date.parse(tl.start) + tl.t[selected] * 86_400_000)
            .toISOString()
            .slice(0, 16)
            .replace('T', ' ')}{' '}
          UTC
        </output>
        <input
          id="timeline-inspection"
          type="range"
          min={0}
          max={tl.t.length - 1}
          step={1}
          value={selected}
          aria-label="Timeline review time"
          onChange={(event) => onReview(Number(event.target.value))}
        />
        {children}
      </div>
      <p className="hint">
        {tl.start.slice(0, 10)} → {tl.end.slice(0, 10)} UTC · {tl.stepMinutes}{' '}
        min step · observer height {observerHeightM} m. Solid lines are the body
        centre’s elevation, dashed lines the terrain horizon at that azimuth.
        Bars are the server’s visible periods. Use the chart or the slider to
        check actual sample times. Earth visibility does not mean link quality.
      </p>
    </>
  )
}
