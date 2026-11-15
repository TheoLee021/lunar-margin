import { useId, useMemo, useState } from 'react'
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
  hour,
}: {
  timeline: Timeline
  duration: number
  hour: number
}) {
  const [inspection, setInspection] = useState<number | null>(null)
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
    return <p className="hint">선택한 기간의 분석 표본이 없습니다.</p>
  const current = Math.max(
    0,
    tl.t.findLastIndex((t) => t <= hour / 24),
  )
  const selected = Math.min(tl.t.length - 1, inspection ?? current)
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
      title: '태양',
      header: 20,
      bar: 245,
      color: 'var(--sun)',
      values: tl.sunEl,
      cutoff: tl.sunHz,
      visible: tl.sunVis,
      segments: tl.sunPeriods,
      yes: '햇빛 있음',
      no: '햇빛 없음',
      barTitle: '햇빛',
    },
    {
      key: 'earth',
      title: '지구',
      header: 42,
      bar: 292,
      color: 'var(--earth)',
      values: tl.earthEl,
      cutoff: tl.earthHz,
      visible: tl.earthVis,
      segments: tl.earthPeriods,
      yes: '지구 가시',
      no: '지구 차폐',
      barTitle: '지구 가시성',
    },
  ]
  return (
    <>
      <div className="mission-timeline-guide">
        <span>색 막대 = 가시 구간</span>
        <span className="timeline-blocked-key">빗금 = 차폐 구간</span>
      </div>
      <svg
        className="unified-timeline"
        viewBox={`0 0 ${width} 345`}
        role="img"
        aria-label="고도각과 햇빛·지구 가시성을 함께 표시하는 타임라인"
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
          setInspection(nearestIndex(tl.t, time))
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
          고도각 (°)
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
                  ? '실선: 태양 / 점선: 지형 지평선'
                  : '실선: 지구 / 점선: 지형 지평선'}
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
        <label htmlFor="timeline-inspection">검토 시점</label>
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
          aria-label="타임라인 검토 시점"
          onChange={(event) => setInspection(Number(event.target.value))}
        />
      </div>
      <p className="hint">
        {tl.start.slice(0, 10)} → {tl.end.slice(0, 10)} UTC · {tl.stepMinutes}분
        간격 · 관측 높이 0 m. 실선은 천체 중심 고도, 점선은 그 방위각의 지형
        지평선입니다. 색 막대는 서버의 가시 구간입니다. 그래프나 슬라이더로 실제
        표본 시각을 확인하세요. 지구 가시성은 통신 품질을 뜻하지 않습니다.
      </p>
    </>
  )
}
